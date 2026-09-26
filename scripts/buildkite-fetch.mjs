// `fetch` for api.buildkite.com that waits out a 429 or a 5xx. Shared by the
// scripts that make many REST requests in a row (scripts/ci-slowest-tests.ts,
// scripts/update-test-durations.mjs and scripts/update-parallel-allowlist.mjs).
// Plain .mjs so the last two keep running under node.
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
 * @property {number} [retries] how many times to ask again after a 429 or a 5xx
 * @property {number} [maxWaitMs] upper bound for one wait, before the extra second
 * @property {(ms: number) => Promise<unknown>} [sleep] tests pass a stub
 */

/** @param {number} ms */
function announceAndSleep(ms) {
  console.error(`  waiting ${ms / 1000}s for Buildkite (rate limit or server error)`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @param {Headers} headers the headers of the 429 or 5xx response
 * @param {{ reset?: unknown } | null} body its body parsed as JSON, or null if it is not JSON
 * @param {number} attempt how many requests were made so far
 * @param {number} maxWaitMs
 * @returns {number} milliseconds to wait before the next request
 */
function retryDelayMs(headers, body, attempt, maxWaitMs) {
  const seconds = Number(headers.get("retry-after") ?? body?.reset);
  // `reset` counts whole seconds. One second on top puts the retry after the
  // reset and not just before it. Without a hint, back off exponentially.
  if (seconds >= 0) return Math.min(seconds * 1000, maxWaitMs) + 1000;
  return Math.min(1000 * 2 ** (attempt - 1), maxWaitMs);
}

/**
 * @param {string} url
 * @param {BuildkiteFetchOptions} options
 * @returns {Promise<Response>} a response with an ok status
 */
export async function fetchBuildkite(url, { token, retries = 5, maxWaitMs = 60_000, sleep = announceAndSleep }) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) return response;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt > retries) {
      throw new Error(`${response.status} ${url}` + (attempt > 1 ? ` (${attempt} attempts)` : ""));
    }
    const body = await response.json().catch(() => null);
    await sleep(retryDelayMs(response.headers, body, attempt, maxWaitMs));
  }
}
