// STATISTIC: CollectionMethodsCalledByStub >= 7
const said: unknown[] = [];
function look(table: Map<unknown, unknown>, key: unknown): void {
  try { said.push(String(table.get(key))); } catch (e) { said.push((e as Error).constructor.name); }
  try { said.push(String(table.has(key))); } catch (e) { said.push((e as Error).constructor.name); }
  try { said.push(typeof table.set(key, 1)); } catch (e) { said.push((e as Error).constructor.name); }
  try { said.push(String(table.delete(key))); } catch (e) { said.push((e as Error).constructor.name); }
}
function mark(seen: Set<unknown>, key: unknown): void {
  try { said.push(String(seen.has(key))); } catch (e) { said.push((e as Error).constructor.name); }
  try { said.push(typeof seen.add(key)); } catch (e) { said.push((e as Error).constructor.name); }
  try { said.push(String(seen.delete(key))); } catch (e) { said.push((e as Error).constructor.name); }
}
const handle = {};
const record = { get(k: unknown) { return "got " + String(k); }, has() { return "has"; }, set() { return 7; }, delete() { return "gone"; }, add() { return 8; } };
const others: unknown[] = [new WeakMap([[handle, 5]]), new WeakSet([handle]), new Set([handle]), new Map([[handle, 6]]), record, Object.create(record), new Proxy(new Map(), {}), new Proxy(record, {}), null, undefined, 5, 5.5, "text", true, Symbol.iterator, 5n, [], () => 1, Object.create(Map.prototype), Object.create(Set.prototype), new Headers({ a: "b" }), new URLSearchParams("a=b")];
for (let turn = 0; turn < 60; turn++) { said.length = 0;
  for (const other of others) { look(other as Map<unknown, unknown>, handle); look(other as Map<unknown, unknown>, "a"); mark(other as Set<unknown>, handle); mark(other as Set<unknown>, "a"); }
}
console.log(said.join(" "));
