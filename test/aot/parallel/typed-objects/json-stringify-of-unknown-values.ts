// Typed values written by code that does not know their type: every line must read as plain Bun.
// ENV JSC_aotCountsPath=/dev/null
// Env: JSC_aotCountsPath=/dev/null
declare const aotRuntimeCounters: () => string;
declare const aotOperationCount: undefined | ((name: string) => number);
const writers: Record<string, (value: unknown) => string> = {
  write: (value) => JSON.stringify(value) as string,
  attempt: (value) => { try { return JSON.stringify(value) as string; } catch (error) { return (error as Error).constructor.name; } },
};
const write = (value: unknown) => writers["write"]!(value);
const attempt = (value: unknown) => writers["attempt"]!(value);
const say = (value: unknown) => console.log(String(value));

class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
class Named { name: string; at: Point; constructor(name: string, at: Point) { this.name = name; this.at = at; } }
class Later { id: number; constructor(id: number) { this.id = id; } }
class WithMethod { id: number; constructor(id: number) { this.id = id; } toJSON() { return { byMethod: this.id }; } }
class Heir extends Later { more: string; constructor(id: number, more: string) { super(id); this.more = more; } }
interface Carrier { toJSON: () => string; kept: number }
interface Row { id: number; text: string; on: boolean; ratio: number; next: Row | null; list: number[]; maybe?: string; nothing: undefined; nil: null }
interface Deep { depth: number; inner: Deep | null }
interface Holds { value: unknown }

function row(id: number): Row { return { id, text: "t" + id, on: id % 2 === 0, ratio: id / 8, next: null, list: [id, id + 1], nothing: undefined, nil: null }; }
function holds(value: unknown): Holds { return { value }; }

say(write(new Point(1, 2)));
say(write(new Named("n", new Point(3, 4))));
say(write(new Heir(5, "more")));
say(write(new WithMethod(6)));
say(write([new WithMethod(7), new Point(8, 9)]));
say(write(holds(new WithMethod(10))));

const laterBase: Record<string, unknown> = Object.create(Later.prototype);
const later = new Later(11);
Object.setPrototypeOf(later, laterBase);
say(write(later));
laterBase["toJSON"] = function (this: Later) { return "added to the prototype " + this.id; };
say(write(later));
say(write([later]));
say(write(holds(later)));
delete laterBase["toJSON"];
say(write(later));
say(write(new Heir(17, "heir")));

const carrier: Carrier = { toJSON: () => "from the field", kept: 1 };
say(write(carrier));
say(write([carrier]));
say(write(holds(carrier)));

const custom = row(18);
Object.setPrototypeOf(custom, { toJSON() { return "through another prototype"; } });
say(write(custom));
say(write([row(19), custom]));
const bare = row(20);
Object.setPrototypeOf(bare, null);
say(write(bare));

const chained = Object.create({ toJSON() { return "two steps up"; } });
const lifted = row(21);
Object.setPrototypeOf(lifted, chained);
say(write(lifted));
say(write([lifted]));
Object.setPrototypeOf(lifted, Object.prototype);
say(write(lifted));

const listWithToJSON: number[] = [1, 2];
(listWithToJSON as unknown as Record<string, unknown>)["toJSON"] = () => "own toJSON of a list";
say(write(listWithToJSON));
say(write(holds(listWithToJSON)));
say(write([listWithToJSON]));
class List extends Array<number> { toJSON() { return "a subclass"; } }
say(write(List.from([1, 2])));
say(write(holds(List.from([3]))));
const otherList = [1, 2];
Object.setPrototypeOf(otherList, { toJSON() { return "a list with another prototype"; } });
say(write(otherList));
say(write(holds(otherList)));

say(write([1, , 3]));
say(write(holds([1, , 3])));
say(write(holds([1.5, , 3.5])));
say(write(holds(["a", , "c"])));
say(write(holds([undefined, null, () => 1, Symbol("s"), true, false, 0, -0, NaN, Infinity, 1e21, 0.1])));
say(write(holds(new Array(3))));
say(write(holds([])));
say(write([[], [[]], [[], [1]]]));
say(write(holds([NaN, 1.5])));
const inherited = [1, , 3];
Object.setPrototypeOf(inherited, Object.create(Array.prototype, { 1: { value: "inherited element" } }));
say(write(holds(inherited)));
const sparse: number[] = [];
sparse[100000] = 1;
say(write(holds(sparse)).length);
const accessor: number[] = [1, 2];
Object.defineProperty(accessor, 0, { get() { return "a getter in a list"; } });
say(write(holds(accessor)));

say(write(holds({ plain: true, nested: { a: [1, { b: 2 }] } })));
say(write([{ a: 1 }, { b: 2 }, row(23)]));
say(write([row(24), { a: 1 }, [{ b: 2 }]]));
say(write(holds(new Map([[1, 2]]))));
say(write(holds(new Set([1]))));
say(write(holds(new Date(0))));
say(write(holds(new Date(NaN))));
say(write(holds(new Number(5))));
say(write(holds(new String("boxed"))));
say(write(holds(new Boolean(false))));
say(write(holds(new Uint8Array([1, 2]))));
say(write(holds(/x/)));
say(write(holds(new Proxy({ through: 1 }, {}))));
say(write(holds(new Proxy([1], {}))));
say(attempt(holds(10n)));
say(attempt([10n]));
say(attempt(holds(Object(10n))));

say(write(undefined));
say(write(() => 1));
say(write(Symbol("s")));
say(write(null));
say(write(true));
say(write(1.5));
say(write("top \"level\""));
say(write("top 日本"));
say(write(holds(undefined)));
say(write(holds(() => 1)));
say(write(holds(Symbol("s"))));

const loop = row(25);
loop.next = loop;
say(attempt(loop));
say(attempt([loop]));
const ring: unknown[] = [];
ring.push(holds(ring));
say(attempt(ring));

let deep: Deep = { depth: 0, inner: null };
for (let i = 1; i <= 47; i++) deep = { depth: i, inner: deep };
say(write(deep));
for (let i = 48; i <= 60; i++) deep = { depth: i, inner: deep };
say(write(deep));
for (let i = 61; i <= 6000; i++) deep = { depth: i, inner: deep };
say(write(deep).length);
let lists: unknown[] = [];
for (let i = 0; i < 5000; i++) lists = [lists];
say(write(lists).length);

const text = (id: string): Row => ({ ...row(1), text: id });
say(write(text("quote \" back \\ line \n tab \t bell \u0007")));
say(write(text("wide 日本語 😀")));
say(write(text("lone \ud800 surrogate")));
say(write(text("latin é ÿ")));
say(write([text("a日"), text("b"), text("c😀")]));
say(write(holds(["日", "b", "😀"])));
let rope = "x";
for (let i = 0; i < 12; i++) rope = rope + "y" + i;
say(write(text(rope)));
say(write(text("rope " + rope + "日")));
for (const length of [60, 61, 62, 63, 64, 65, 127, 128, 129, 4000, 4030, 4096, 5000, 70000]) {
  const filler = "z".repeat(length);
  say(write(text(filler)).length);
  say(write([text(filler), text(filler), 1, true, null]).length);
  say(write([text(filler + "\n"), text(filler + "日"), 1]).length);
  say(write(holds([filler, filler + "\""])).length);
}

const frozen = Object.freeze(row(26));
say(write(frozen));
say(write(holds(frozen)));
const sealed = Object.seal(row(27));
say(write(sealed));
const stiff = Object.preventExtensions(row(28));
say(write(stiff));
const extra = row(29);
(extra as unknown as Record<string, unknown>)["added"] = "later";
say(write(extra));
say(write([extra, row(30)]));
const gone = row(31);
delete (gone as unknown as Record<string, unknown>)["text"];
say(write(gone));
const again = row(32);
delete (again as unknown as Record<string, unknown>)["text"];
(again as unknown as Record<string, unknown>)["text"] = "after the others";
say(write(again));
const getter = row(33);
Object.defineProperty(getter, "text", { get() { return "from a getter"; }, enumerable: true });
say(write(getter));
const hidden = row(34);
Object.defineProperty(hidden, "text", { enumerable: false });
say(write(hidden));
const optional = row(35);
optional.maybe = "there";
say(write(optional));
say(write([row(36), optional, row(37)]));
const reorder = { ...row(38), maybe: "spread" };
say(write(reorder));
const wrongKind = row(39);
(wrongKind as unknown as Record<string, unknown>)["id"] = "a text where a number goes";
(wrongKind as unknown as Record<string, unknown>)["ratio"] = { object: 1 };
(wrongKind as unknown as Record<string, unknown>)["on"] = undefined;
say(write(wrongKind));
const numbers = row(40);
numbers.id = 2147483647; numbers.ratio = -0;
say(write(numbers));
numbers.id = -2147483648; numbers.ratio = NaN;
say(write(numbers));
numbers.id = 2147483648.5; numbers.ratio = Infinity;
say(write(numbers));
numbers.id = 1e300; numbers.ratio = 5e-324;
say(write(numbers));


const plain: unknown = JSON.parse('{"p":1,"q":[2,{"r":"s"}]}');
say(write([plain]));
say(write([plain, row(50)]));
say(write([row(51), plain]));
say(write([1, plain]));
say(write([[plain]]));
say(write([[row(52)], [plain]]));
say(write(["wide 日本", plain]));
say(write("after a list with wide text that was given up"));
say(write(["narrow"]));
say(write(["wide again 日本"]));
say(write(["z".repeat(70000), plain]).length);
say(write(row(53)));
say(write(["z".repeat(70000) + "日", "y".repeat(70000), plain]).length);
say(write(row(54)));
say(write([row(55), "quote \" in a list", plain]));
say(write(holds([row(56), plain])));
say(write(holds([plain, row(57)])));
say(write([new Map([[1, 2]]), row(58)]));
say(write([row(59), new Date(0), /x/, new Set([1])]));

say(write([[plain]]));
say(write([[row(60)], [[plain]]]));
say(write([[["deep 日"]], [[plain]]]));
say(write(row(61)));
say(write(holds([[row(62)], [plain]])));
say(write(holds([["nested 日", [plain]]])));
say(write(row(63)));

if (typeof aotOperationCount === "function") {
  const list = [holds(45), holds(46)];
  // The texts that JSON.stringify left to the engine's own writer, and the values that compiled code handed to the run time.
  const count = aotOperationCount;
  const leftToTheEngine = () => Number(/(\d+)\tcounter:JSONStringifySlowPaths/.exec(aotRuntimeCounters())?.[1] ?? 0) + count("operationAOTJSONAppendValue") + count("operationAOTStringBuilderAppendJSON");
  const before = leftToTheEngine();
  for (let i = 0; i < 10; i++) {
    write(holds(i));
    write(list);
  }
  if (leftToTheEngine() !== before) throw new Error("a value of unknown type was left to the engine's own writer");
}
