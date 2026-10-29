// `list.push(v)` where v is an integer that the compiler keeps in 64 bits (a count that may pass 2 ** 31, a product, a length) and the list is declared to hold numbers.
// The list may hold int32, doubles or boxed values when the push runs, may be full, frozen, or no plain array at all.
const launder = new Function("v", process.env.LAUNDER_TEXT ?? "return v") as <V>(v: V) => V;
const show = (label: string, list: unknown[]) => console.log(label, list.length, list.map((v) => (Object.is(v, -0) ? "-0" : typeof v + ":" + String(v))).join(" "));

function pushCount(list: number[], from: number, rounds: number): number {
  let last = 0;
  for (let i = 0; i < rounds; i++) last = list.push(from + i * 1073741824);
  return last;
}
function pushLengths(list: number[], texts: string[]): void { let total = 0; for (const t of texts) { total += t.length * 65536 * 4096; list.push(total); } }
function pushTwice(list: number[], v: number): number { const wide = v * 2 + 4294967296; list.push(wide); return list.push(wide + 1); }
function pushPositions(text: string): number[] { const result: number[] = []; let start = 0; for (let pos = 0; pos < text.length; pos++) { if (text.charCodeAt(pos) === 10) { result.push(start); start = pos + 1; } } result.push(start); return result; }
function pushUnsigned(list: number[], v: number): void { list.push(v >>> 0); list.push((v >>> 0) + 1); list.push(-(v >>> 0)); }

const empty: number[] = [];
console.log(pushCount(empty, 0, 5)); show("from empty", empty);
const ints: number[] = [1, 2, 3];
console.log(pushCount(ints, -2147483648, 5)); show("from int32", ints);
const halves: number[] = [0.5, 1.5];
console.log(pushCount(halves, 7, 3)); show("from doubles", halves);
const mixed = launder<number[]>(["a", {}, 1] as unknown as number[]);
console.log(pushCount(mixed, 9007199254740000, 2)); console.log("boxed", mixed.length, typeof mixed[3], mixed[3], mixed[4]);
const unseen = launder<number[]>(JSON.parse("[1,2]"));
console.log(pushCount(unseen, 5, 4)); show("from JSON", unseen);
const holes: number[] = new Array(3);
console.log(pushCount(holes, 1, 2)); show("behind holes", holes);
const lengths: number[] = []; pushLengths(lengths, ["a", "bb", "", "cccccccc", "dddddddddddddddd"]); show("lengths", lengths);
const twice: number[] = []; console.log(pushTwice(twice, 3), pushTwice(twice, -2147483648), pushTwice(twice, 0.25)); show("twice", twice);
show("positions", pushPositions("ab\ncd\n\nef"));
const unsigned: number[] = []; for (const v of [0, -1, 2147483648, 1.5, -0]) pushUnsigned(unsigned, v); show("unsigned", unsigned);
const many: number[] = []; console.log(pushCount(many, 1, 3000), many[2999], many[1500], many.length);
for (const [label, list] of [["frozen", Object.freeze([1])], ["sealed", Object.seal([1])], ["not extensible", Object.preventExtensions([1])]] as [string, number[]][]) {
  try { console.log(label, pushCount(list, 4294967296, 1)); } catch (error) { console.log(label, (error as Error).constructor.name, list.length); }
}
class Counted extends Array<number> { pushes = 0; push(...items: number[]): number { this.pushes += items.length; return super.push(...items); } }
const counted = new Counted(); console.log(pushCount(counted, 4294967296, 2), counted.pushes, counted.length, counted[1]);
const watched: number[] = []; Object.defineProperty(watched, "2", { set(v) { console.log("setter", v); }, configurable: true }); console.log(pushCount(watched, 8589934592, 1), watched.length);
const like = launder({ length: 4294967294, push: Array.prototype.push }) as unknown as number[];
console.log(pushCount(like, 4294967296, 1), like.length, (like as any)[4294967294]);
