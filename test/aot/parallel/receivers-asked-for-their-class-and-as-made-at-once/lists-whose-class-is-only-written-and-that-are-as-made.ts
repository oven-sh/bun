const log: string[] = []; const drawer: unknown[] = [0, "text", new WeakMap<object, number>()];
function left<T extends object>(value: T): T { drawer[3] = value; return drawer[3 + (log.length & 0)] as T; }
function use(list: number[]): void { try { log.push([list.push(7), list.includes(9), list.indexOf(7), list.join("-"), list.pop(), list.length].map(String).join(" ")); } catch (e) { log.push((e as Error).name); } }
for (let turn = 0; turn < 200; turn++) { log.length = 0; use(left([1, 2]));
  const tagged = [1, 2] as number[] & { note?: number }; tagged.note = 1; use(left(tagged)); use(left(Object.freeze([1, 2]) as number[])); }
console.log(log.join("\n"));
