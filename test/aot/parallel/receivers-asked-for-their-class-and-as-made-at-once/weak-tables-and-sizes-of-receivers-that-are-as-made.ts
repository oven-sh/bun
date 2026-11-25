const log: string[] = []; const drawer: unknown[] = [0, "text", [1]]; const key = {}; const other = {};
function left<T extends object>(value: T): T { drawer[3] = value; return drawer[3 + (log.length & 0)] as T; }
function ask(table: WeakMap<object, number>, seen: WeakSet<object>, sized: Map<string, number> | Set<string>): void { log.push([table.set(key, 5) === table, table.get(key), table.has(other), seen.has(key), sized.size].map(String).join(" ")); }
for (let turn = 0; turn < 200; turn++) { log.length = 0; ask(left(new WeakMap()), left(new WeakSet([key])), left(new Map([["a", 1]]))); ask(left(new WeakMap()), left(new WeakSet()), left(new Set(["a", "b"]))); }
console.log(log.join("\n"));
