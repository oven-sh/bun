// The result of an arithmetic operator on `any` operands is a number or a BigInt, whatever TypeScript infers for it.
const show = (name: string, f: () => unknown) => {
  let text: string
  try { const v = f(); text = typeof v + " " + String(v) } catch (e) { text = "throws " + (e as Error).constructor.name }
  console.log(name + ": " + text)
}
function inc(n: any) { n++; return n }
function dec(n: any) { return --n }
function post(n: any) { const old = n++; return [typeof old, old, typeof n, n].join() }
function neg(n: any) { return -n }
function not(n: any) { return ~n }
function plus(n: any) { return +n }
function mul(a: any, b: any) { return a * b }
function sub(a: any, b: any) { return a - b }
function div(a: any, b: any) { return a / b }
function rem(a: any, b: any) { return a % b }
function pow(a: any, b: any) { return a ** b }
function shl(a: any, b: any) { return a << b }
function shr(a: any, b: any) { return a >> b }
function ushr(a: any, b: any) { return a >>> b }
function and(a: any, b: any) { return a & b }
function or(a: any, b: any) { return a | b }
function xor(a: any, b: any) { return a ^ b }
function add(a: any, b: any) { return a + b }
function twice(a: any) { return a * 2 }
function lowBit(a: any) { const b = a & 1; return b }
function stored(a: any, b: any) { a *= b; return a }
function kept(a: any, b: any) { let r = a * b; r = r - b; return r }
function ofUnknown(a: unknown) { return -(a as any) }
function property(o: any) { o.n++; return o.n }
function field(o: { n: any }) { o.n--; return o.n }
function element(list: any[]) { list[0]++; return list[0] }
function numbers(a: number, b: number) { let r = a * b; r++; return -r }
function bigints(a: bigint, b: bigint) { let r = a * b; r++; return -r }
const one: [string, (n: any) => unknown][] = [["inc", inc], ["dec", dec], ["post", post], ["neg", neg], ["not", not], ["plus", plus], ["twice", twice], ["lowBit", lowBit], ["ofUnknown", ofUnknown]]
const two: [string, (a: any, b: any) => unknown][] = [["mul", mul], ["sub", sub], ["div", div], ["rem", rem], ["pow", pow], ["shl", shl], ["shr", shr], ["ushr", ushr], ["and", and], ["or", or], ["xor", xor], ["add", add], ["stored", stored], ["kept", kept]]
for (const [name, f] of one) for (const n of [5, 5n, "5", null, undefined, { valueOf() { return 7n } }, { valueOf() { return 7 } }]) show(name, () => f(n))
for (const [name, f] of two) for (const [a, b] of [[7, 2], [7n, 2n], [7n, 2], ["7", "2"], [{ valueOf() { return 7n } }, 2n], [7, { valueOf() { return 2 } }]]) show(name, () => f(a, b))
show("property", () => property({ n: 1n })); show("property", () => property({ n: 1 }))
show("field", () => field({ n: 1n })); show("field", () => field({ n: "4" }))
show("element", () => element([1n])); show("element", () => element([1.5]))
show("numbers", () => numbers(2, 3)); show("bigints", () => bigints(2n, 3n))
