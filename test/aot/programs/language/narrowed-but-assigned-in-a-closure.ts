// TypeScript narrows a `let` by the last assignment in the same function and ignores assignments in nested functions.
async function withRetry<T>(f: () => Promise<T>): Promise<T> { return await f(); }
type Reply = { headers: string };
async function query(n: number) {
  let id: string | null | undefined = undefined;
  let reply: Reply | undefined = undefined;
  let at: number | undefined = undefined;
  await withRetry(async () => { id = "req_" + n; reply = { headers: "h" + n }; at = n * 2; });
  const row = { requestId: id ?? undefined, orNull: id ?? null, at };
  // The control flow analysis cannot see that `reply` is set in the callback.
  const r = reply as unknown as Reply | undefined;
  console.log(row.requestId, row.orNull, row.at, r ? r.headers : "none");
}
function sync(n: number) {
  let found: string | undefined = undefined;
  [n].forEach(k => { found = "k" + k; });
  const kept = { found };
  let count: number | null = null;
  const bump = () => { count = (count ?? 0) + 1; };
  bump(); bump();
  console.log(kept.found, found ?? "nothing", count ?? -1, typeof found);
}
await query(1);
sync(2);
