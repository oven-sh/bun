// Objects from untyped code that SATISFY a record type which the program also makes itself: the member is an accessor, inherited, not enumerable; the object is a function, an array, a Map, an Error, a Proxy, an instance of a class. Nothing can be made of them. They meet the type wherever a type is written. Each stays the object it is and is read by name.
type Part = { id?: number; name?: string; more?: unknown };
type Whole = { k: Part };
function own(): Whole { return { k: { id: 7 } }; }
function load(given: any): Whole { return given; }
function take(answer: Whole, source: unknown): unknown[] { return seen(answer, source); }
class Holder { value: Whole; constructor(given: any) { this.value = given; } }
function wider(given: { k: Part; j?: number }): unknown { return [given.k.id, given.j]; }
function seen(answer: Whole, source: unknown): unknown[] { return [answer.k.id, answer === source, wider(answer), Object.keys(answer).length, typeof answer, Array.isArray(answer), Object.getPrototypeOf(answer) === Object.getPrototypeOf(source), [answer, own()].map(one => one.k.id)]; }
async function attempt(name: string, f: () => unknown): Promise<void> { try { console.log(name, JSON.stringify(await f())); } catch (e) { console.log(name, (e as Error).name + ": " + (e as Error).message.split("\n").slice(0, 2).join(" | ").replace(/ \(bun compile[^)]*\)/, "").slice(0, 120)); } }
const makers: [string, () => any][] = [
  ["parsed", () => JSON.parse('{"k": {"id": 1}}')],
  ["an accessor", () => Object.defineProperty({}, 'k', { get() { return { id: 1 } }, enumerable: true })],
  ["an accessor with a setter", () => (() => { let held: any = { id: 1 }; return Object.defineProperty({}, 'k', { get() { return held }, set(value) { held = value }, enumerable: true }) })()],
  ["no prototype", () => Object.assign(Object.create(null), { k: { id: 1 } })],
  ["an inherited member", () => Object.create({ k: { id: 1 } })],
  ["frozen", () => Object.freeze({ k: { id: 1 } } as any)],
  ["sealed", () => Object.seal({ k: { id: 1 } } as any)],
  ["not writable", () => Object.defineProperty({}, 'k', { value: { id: 1 }, writable: false, enumerable: true })],
  ["not enumerable", () => Object.defineProperty({}, 'k', { value: { id: 1 }, writable: true, enumerable: false, configurable: true })],
  ["extra members", () => JSON.parse('{"z": 1, "k": {"id": 1}, "y": [2], "x": "3", "w": null, "v": true, "u": 7, "t": 8}')],
  ["a symbol key", () => Object.assign({ k: { id: 1 } } as any, { [Symbol.for('s')]: 1 })],
  ["a function", () => Object.assign(function () {}, { k: { id: 1 } })],
  ["an array", () => Object.assign([1, 2], { k: { id: 1 } })],
  ["a proxy", () => new Proxy({ k: { id: 1 } }, {})],
  ["an instance of a class", () => new (class Loose { k: any = { id: 1 } } as any)()],
  ["a Map", () => Object.assign(new Map(), { k: { id: 1 } })],
  ["an Error", () => Object.assign(new Error('x'), { k: { id: 1 } })],
]
for (const [name, make] of makers) {
  await attempt(name + ", an annotated variable:", () => { const source = make(); const answer: Whole = source; return seen(answer, source); });
  await attempt(name + ", a cast:", () => { const source = make(); const answer = source as Whole; return seen(answer, source); });
  await attempt(name + ", a return annotation:", () => { const source = make(); return seen(load(source), source); });
  await attempt(name + ", a parameter:", () => { const source = make(); return take(source, source); });
  await attempt(name + ", a field of a class:", () => { const source = make(); return seen(new Holder(source).value, source); });
  await attempt(name + ", an element:", () => { const source = make(); const list: Whole[] = [source]; return seen(list[0]!, source); });
}
