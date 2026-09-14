// How long to wait after api.buildkite.com refused a request with a 429 or a
// 5xx. Shared by the scripts that make many REST requests in a row
// (scripts/ci-slowest-tests.ts, scripts/update-test-durations.mjs and
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
 * @param {Response} response a 429 or a 5xx. This reads its body.
 * @param {number} attempt how many requests were made so far, 1 after the first
 * @param {number} [maxWaitMs] upper bound for the wait that the response can ask for
 * @returns {Promise<number>} milliseconds to wait before the next request
 */
export async function retryDelayMs(response, attempt, maxWaitMs = 60_000) {
  const body = await response.json().catch(() => null);
  const seconds = Number(response.headers.get("retry-after") ?? body?.reset);
  // `reset` counts whole seconds. One second on top puts the retry after the
  // reset and not just before it. Without a hint, back off exponentially.
  return seconds >= 0 ? Math.min(seconds * 1000, maxWaitMs) + 1000 : 1000 * 2 ** (attempt - 1);
}
