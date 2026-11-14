// `fetch` for api.buildkite.com that asks again after a 429, a 5xx, or a
// connection that failed. Shared by the scripts that make many REST requests in
// a row (scripts/ci-slowest-tests.ts, scripts/update-test-durations.mjs and
// scripts/update-parallel-allowlist.mjs). Plain .mjs so the last two keep
// running under node.
//
// Buildkite limits the REST requests per minute twice: for the organization
// and for the user of the token. Each limit has its own window and its own
// `RateLimit-*` headers, so a header can be for the limit that was not
// exceeded. A 429 has no Retry-After. Its body is for the limit that was
// exceeded: `{ message, scope, limit, current, reset }`.
// https://buildkite.com/docs/apis/rest-api/limits

/**
 * @typedef {object} BuildkiteFetchOptions
 * @property {string} token
 * @property {number} [retries] how many times to ask again
 * @property {number} [maxWaitMs] upper bound for one wait, before the extra second
 * @property {(ms: number, reason: string) => Promise<unknown>} [sleep] tests pass a stub
 */

/**
 * @typedef {{ text: string } | { problem: string, retryable: boolean, waitSeconds: number }} Reply
 * `text`: the body of a response with an ok status. Otherwise `problem` names
 * what went wrong (`429`, `ECONNRESET`), and `waitSeconds` is how long the
 * server asks to wait, or NaN.
 */

/**
 * @param {number} ms
 * @param {string} reason
 */
function announceAndSleep(ms, reason) {
  console.error(`  waiting ${ms / 1000}s for Buildkite (${reason})`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** @param {string} text */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * One request. It reads the body too, because a connection can also drop in
 * the middle of the body.
 * @param {string} url
 * @param {string} token
 * @returns {Promise<Reply>}
 */
async function request(url, token) {
  let response, text;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    text = await response.text();
  } catch (error) {
    // No complete response: the connection failed or the request timed out.
    // Node puts the code (`ECONNRESET`) on `cause`.
    const code = error?.cause?.code ?? error?.code;
    return { problem: typeof code === "string" ? code : String(error), retryable: true, waitSeconds: NaN };
  }
  if (response.ok) return { text };
  return {
    problem: String(response.status),
    retryable: response.status === 429 || response.status >= 500,
    waitSeconds: Number(response.headers.get("retry-after") ?? parseJson(text)?.reset),
  };
}

/**
 * @param {string} url
 * @param {BuildkiteFetchOptions} options
 * @returns {Promise<string>} the body of a response with an ok status
 */
export async function fetchBuildkite(url, { token, retries = 5, maxWaitMs = 60_000, sleep = announceAndSleep }) {
  for (let attempt = 1; ; attempt++) {
    const reply = await request(url, token);
    if ("text" in reply) return reply.text;
    if (!reply.retryable || attempt > retries) {
      throw new Error(`${reply.problem} ${url}` + (attempt > 1 ? ` (${attempt} attempts)` : ""));
    }
    // `waitSeconds` counts whole seconds. One second on top puts the retry after
    // the reset and not just before it. Without it, back off exponentially.
    const wait =
      reply.waitSeconds >= 0
        ? Math.min(reply.waitSeconds * 1000, maxWaitMs) + 1000
        : Math.min(1000 * 2 ** (attempt - 1), maxWaitMs);
    await sleep(wait, reply.problem);
  }
}
