const log: string[] = []; const drawer: unknown[] = [0, "text", new WeakMap<object, number>()];
function left<T extends object>(value: T): T { drawer[3] = value; return drawer[3 + (log.length & 0)] as T; }
function use(list: number[]): void { try { log.push([list.push(7), list.includes(9), list.indexOf(7), list.join("-"), list.pop(), list.length].map(String).join(" ")); } catch (e) { log.push((e as Error).name); } }
class Stack extends Array<number> { push(...items: number[]): number { return -items.length; } includes(): boolean { return true; } }
for (let turn = 0; turn < 200; turn++) { log.length = 0; use(left([1, 2]));
  const tagged = [1, 2] as number[] & { note?: number }; tagged.note = 1; use(left(tagged));
  const own = [1, 2]; (own as any).push = () => "own"; use(left(own));
  const moved = [1, 2]; Object.setPrototypeOf(moved, { __proto__: Array.prototype, includes() { return "above"; }, pop() { return "kept"; } }); use(left(moved));
  const stack = new Stack(); stack[0] = 1; stack[1] = 2; use(left(stack));
  const odd = [1, 2, 3]; Object.defineProperty(odd, 1, { get() { return 7; }, configurable: true }); use(left(odd));
  use(left(Object.freeze([1, 2]) as number[])); const bare = [1, 2]; Object.setPrototypeOf(bare, null); use(left(bare)); }
console.log(log.join("\n"));
