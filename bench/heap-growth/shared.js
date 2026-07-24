// Shared request handler + in-memory state for all server frameworks.
// State: ~LIVE_MB of cached records (the live set). Per request: allocate a
// response object graph, look up/insert into cache, stringify.

const LIVE_MB = parseInt(process.env.LIVE_MB ?? "150", 10);
const REC_BYTES = 400; // rough: object + strings + array

function makeRec(i) {
  return {
    id: i,
    name: "item-" + i,
    created: Date.now(),
    tags: ["t" + (i % 7), "t" + (i % 11), "t" + (i % 13)],
    meta: { score: (i * 2654435761) >>> 0, group: i % 100, flags: [i & 1, i & 2, i & 4] },
    blob: "x".repeat(64),
  };
}

function makeCache() {
  const n = Math.floor((LIVE_MB * 1024 * 1024) / REC_BYTES);
  const map = new Map();
  for (let i = 0; i < n; i++) map.set(i, makeRec(i));
  return { map, n };
}

function handle(cache, idStr, query) {
  const id = (parseInt(idStr, 10) >>> 0) % cache.n;
  // per-request allocation: build a response with related records
  const rec = cache.map.get(id) ?? makeRec(id);
  const related = [];
  for (let k = 1; k <= 20; k++) {
    const r = cache.map.get((id + k * 97) % cache.n);
    related.push({ id: r.id, name: r.name, score: r.meta.score });
  }
  // occasionally replace a cache entry (churn in the live set)
  if ((id & 63) === 0) cache.map.set(id, makeRec(id));
  return { ok: true, q: query, rec, related, ts: Date.now() };
}

module.exports = { makeCache, handle };
