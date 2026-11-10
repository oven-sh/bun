const said: unknown[] = [];
const shelf: unknown[] = [0, "text", new WeakMap<object, number>()];
function from<T extends object>(value: T): T { shelf[3] = value; return shelf[3 + (said.length & 0)] as T; }
function fill(table: Map<string, unknown>, seen: Set<string>, many: number, tag: string): void {
  for (let i = 0; i < many; i++) { table.set(tag + i, i & 1 ? i : { i }); seen.add(tag + i); }
  let found = 0; for (let i = 0; i < many + 3; i++) { if (table.has(tag + i)) found++; if (seen.has(tag + i)) found++; if (table.get(tag + i) !== undefined) found++; }
  let gone = 0; for (let i = 0; i < many; i += 2) { if (table.delete(tag + i)) gone++; if (seen.delete(tag + i)) gone++; }
  said.push(found, gone, table.size, seen.size);
}
function once(table: Map<string, unknown>, key: string, value: unknown): unknown { table.set(key, value); return table.get(key); }
for (let turn = 0; turn < 12; turn++) { said.length = 0;
  for (const many of [0, 1, 7, 8, 9, 63, 64, 65, 300, 5000]) { const table = from(new Map<string, unknown>()); const seen = from(new Set<string>()); fill(table, seen, many, "t"); fill(table, seen, many, "u"); table.clear(); seen.clear(); fill(table, seen, 3, "v"); }
  const changing = from(new Map<string, unknown>());
  said.push(once(changing, "a", 1), once(changing, "a", 1.5), once(changing, "a", "text"), once(changing, "b", changing) === changing, once(changing, "c", undefined), once(changing, "d", 2 ** 40), once(changing, "e", -0) === 0);
  (changing as unknown as { get: unknown }).get = () => "own get now"; said.push(once(changing, "a", 2));
  delete (changing as unknown as { get?: unknown }).get; said.push(once(changing, "a", 3));
  const walked = from(new Map<string, unknown>([["a", 1], ["b", 2], ["c", 3]])); const order: string[] = [];
  for (const [key] of walked) { order.push(key); if (key === "a") { walked.delete("b"); walked.set("d", 4); } if (key === "d") walked.set("b", 5); }
  said.push(order.join(""));
}
console.log(said.map(String).join(" "));
