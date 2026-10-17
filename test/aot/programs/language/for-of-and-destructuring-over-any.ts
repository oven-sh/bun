// `for..of` and destructuring over iterables whose type is not known statically.
function each(x: any, stop = Infinity) { const out: unknown[] = []; let n = 0; for (const v of x) { out.push(v); if (++n >= stop) break } return out.join() }
class Sub extends Array<number> { *[Symbol.iterator](): Generator<number, undefined, unknown> { yield 100; yield 200 } }
class Plain extends Array<number> {}
function ownIterator(a: any) { a[Symbol.iterator] = function* () { yield "own" }; return a }
const closable = { n: 0, closed: 0, [Symbol.iterator]() { return this }, next() { return { done: this.n >= 5, value: this.n++ } }, return() { this.closed++; return {} } }
function* gen() { try { yield 1; yield 2; yield 3 } finally { console.log("finally") } }
const holes: any = [1, , 3]; const doubles: any = [1.5, 2.5]; const mixed: any = [1, "a", null, undefined, ({} as { x?: unknown }).x]
console.log(each([]), each([1, 2, 3]), each(holes), each(doubles), each(mixed), each("héy"), each(new Set([1, 2])), each(new Map([[1, 2]])), each(new Uint8Array([7, 8])))
console.log(each(closable, 2), closable.closed, each(gen(), 1), each((function () { return arguments } as (...given: number[]) => IArguments)(1, 2) as any))
function grow(a: any) { const out: number[] = []; for (const v of a) { out.push(v); if (a.length < 6) a.push(v * 2) } return out.join() }
function shrink(a: any) { const out: number[] = []; for (const v of a) { out.push(v); a.pop() } return out.join() }
function replace(a: any) { const out: unknown[] = []; for (const v of a) { out.push(v); a[2] = "r"; a.length = 3 } return out.join() }
console.log(grow([1, 2]), shrink([1, 2, 3, 4, 5]), replace([1, 2, 3, 4, 5]))
function spreadOf(x: any) { const [a, b = "d", ...rest] = x; return [a, b, rest.length, [...x].length, Math.max(0, ...x)].join() }
console.log(spreadOf([1]), spreadOf([1, 2, 3, 4]), spreadOf(new Set([5, 6, 7])), spreadOf(holes))
for (const bad of [null, undefined, 1, {}, { [Symbol.iterator]: 1 }, { [Symbol.iterator]() { return 1 } }] as any[]) { try { each(bad) } catch (e) { console.log((e as Error).constructor.name) } }
const sparse: any = []; sparse[50000] = 1; let seen = 0; for (const v of sparse) if (v === undefined) seen++
const getter: any = [1, 2, 3]; Object.defineProperty(getter, 1, { get() { return "g" } })
console.log(seen, each(getter), each(Object.freeze([1, 2])))
