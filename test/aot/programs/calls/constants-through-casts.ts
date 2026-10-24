// Constants that go through casts such as `x as number`. A cast is a test and never a conversion: a primitive of another kind throws a TypeError, null passes and stays null, and the answer is the same whether the compiler sees the constant or not.
declare const console: any;
function any(x: unknown): any { return x }
function show(v: unknown): string { return typeof v + " " + (Object.is(v, -0) ? "-0" : String(v)) }
function failure(e: unknown): string { return "throws " + (e as Error).constructor.name }
const H: unknown[] = ((globalThis as any).H = [5, 2, 7, "m", "7", true, 0.5, 3, -1, 0, "5", null, undefined, 1]);
function element(x: number): unknown { return [10, 20, 30, 40, 50, 60][x] }
function argument(x: number, ...rest: number[]): unknown { return rest[x] }
function ofArguments(x: number, a?: number, b?: number, c?: number, d?: number, e?: number, f?: number): unknown { return arguments[x] }
function destructured(x: number): unknown { const [a, b] = [x, 20]; return a + b }
function power(b: number, x: number): unknown { return b ** x }
function mathPow(b: number, x: number): unknown { return Math.pow(b, x) }
function floored(x: number): unknown { return Math.floor(x) }
function ceiled(x: number): unknown { return Math.ceil(x) }
function rounded(x: number): unknown { return Math.round(x) }
function truncated(x: number): unknown { return Math.trunc(x) }
class Base { m(): string { return "Base.m" } NaN(): string { return "Base.NaN" } true(): string { return "Base.true" } static s(): string { return "Base.s" } }
class Derived extends Base { by(key: string): unknown { return (super[key as "m"] as () => string).call(this) } m(): string { return "Derived.m" } }
const derived = new Derived;
function toFixedOf(n: number, receiver: unknown): unknown { return n.toFixed.call(receiver as number) }
let r = "";
for (let turn = 0; turn < 2; turn++) {
  const a = 7 + turn * 0, b = 2 + turn * 0;
  try { r = show(element(any(any(5) as boolean) as number)) } catch (e) { r = failure(e) } console.log("element, 5 > boolean > number, written: " + r);
  try { r = show(element(any(any(H[0]) as boolean) as number)) } catch (e) { r = failure(e) } console.log("element, 5 > boolean > number, hidden:  " + r);
  try { r = show(element(any(any(true) as number) as number)) } catch (e) { r = failure(e) } console.log("element, true > number, written: " + r);
  try { r = show(element(any(any(H[5]) as number) as number)) } catch (e) { r = failure(e) } console.log("element, true > number, hidden:  " + r);
  try { r = show(element(any(any("5") as number) as number)) } catch (e) { r = failure(e) } console.log("element, \"5\" > number, written: " + r);
  try { r = show(element(any(any(H[10]) as number) as number)) } catch (e) { r = failure(e) } console.log("element, \"5\" > number, hidden:  " + r);
  try { r = show(element(any(null) as number)) } catch (e) { r = failure(e) } console.log("element, null > number, written: " + r);
  try { r = show(element(any(H[11]) as number)) } catch (e) { r = failure(e) } console.log("element, null > number, hidden:  " + r);
  try { r = show(element(any(5) as number)) } catch (e) { r = failure(e) } console.log("element, 5 > number, written: " + r);
  try { r = show(element(any(H[0]) as number)) } catch (e) { r = failure(e) } console.log("element, 5 > number, hidden:  " + r);
  try { r = show(argument(any(any(3) as boolean) as number, 10, 20, 30, 40)) } catch (e) { r = failure(e) } console.log("rest, 3 > boolean > number, written: " + r);
  try { r = show(argument(any(any(H[7]) as boolean) as number, 10, 20, 30, 40)) } catch (e) { r = failure(e) } console.log("rest, 3 > boolean > number, hidden:  " + r);
  try { r = show(ofArguments(any(any(3) as boolean) as number, 10, 20, 30, 40)) } catch (e) { r = failure(e) } console.log("arguments, 3 > boolean > number, written: " + r);
  try { r = show(ofArguments(any(any(H[7]) as boolean) as number, 10, 20, 30, 40)) } catch (e) { r = failure(e) } console.log("arguments, 3 > boolean > number, hidden:  " + r);
  try { r = show(destructured(any(any(5) as boolean) as number)) } catch (e) { r = failure(e) } console.log("destructured, 5 > boolean > number, written: " + r);
  try { r = show(destructured(any(any(H[0]) as boolean) as number)) } catch (e) { r = failure(e) } console.log("destructured, 5 > boolean > number, hidden:  " + r);
  try { r = show(power(3 + turn * 0, any(any(2) as boolean) as number)) } catch (e) { r = failure(e) } console.log("**, 2 > boolean > number, written: " + r);
  try { r = show(power(3 + turn * 0, any(any(H[1]) as boolean) as number)) } catch (e) { r = failure(e) } console.log("**, 2 > boolean > number, hidden:  " + r);
  try { r = show(power(9 + turn * 0, any(any(0.5) as boolean) as number)) } catch (e) { r = failure(e) } console.log("**, 0.5 > boolean > number, written: " + r);
  try { r = show(power(9 + turn * 0, any(any(H[6]) as boolean) as number)) } catch (e) { r = failure(e) } console.log("**, 0.5 > boolean > number, hidden:  " + r);
  try { r = show(mathPow(3 + turn * 0, any(any(2) as boolean) as number)) } catch (e) { r = failure(e) } console.log("Math.pow, 2 > boolean > number, written: " + r);
  try { r = show(mathPow(3 + turn * 0, any(any(H[1]) as boolean) as number)) } catch (e) { r = failure(e) } console.log("Math.pow, 2 > boolean > number, hidden:  " + r);
  try { r = show(power(3 + turn * 0, any(2) as number)) } catch (e) { r = failure(e) } console.log("**, 2 > number, written: " + r);
  try { r = show(power(3 + turn * 0, any(H[1]) as number)) } catch (e) { r = failure(e) } console.log("**, 2 > number, hidden:  " + r);
  try { r = show(floored(any(any(a / b) as boolean) as number)) } catch (e) { r = failure(e) } console.log("floor, a / b > boolean > number, in sight: " + r);
  try { r = show(floored(any(any((H[2] as number) / (H[1] as number)) as boolean) as number)) } catch (e) { r = failure(e) } console.log("floor, a / b > boolean > number, hidden:   " + r);
  try { r = show(ceiled(any(any(a / b) as string) as number)) } catch (e) { r = failure(e) } console.log("ceil, a / b > string > number, in sight: " + r);
  try { r = show(ceiled(any(any((H[2] as number) / (H[1] as number)) as string) as number)) } catch (e) { r = failure(e) } console.log("ceil, a / b > string > number, hidden:   " + r);
  try { r = show(rounded(any(any(a / b) as boolean) as number)) } catch (e) { r = failure(e) } console.log("round, a / b > boolean > number, in sight: " + r);
  try { r = show(rounded(any(any((H[2] as number) / (H[1] as number)) as boolean) as number)) } catch (e) { r = failure(e) } console.log("round, a / b > boolean > number, hidden:   " + r);
  try { r = show(truncated(any(any(a / b) as boolean) as number)) } catch (e) { r = failure(e) } console.log("trunc, a / b > boolean > number, in sight: " + r);
  try { r = show(truncated(any(any((H[2] as number) / (H[1] as number)) as boolean) as number)) } catch (e) { r = failure(e) } console.log("trunc, a / b > boolean > number, hidden:   " + r);
  try { r = show(floored(any(a / b) as number)) } catch (e) { r = failure(e) } console.log("floor, a / b > number, in sight: " + r);
  try { r = show(floored(any((H[2] as number) / (H[1] as number)) as number)) } catch (e) { r = failure(e) } console.log("floor, a / b > number, hidden:   " + r);
  try { r = show(derived.by(any(any("m") as number) as string)) } catch (e) { r = failure(e) } console.log("super[key], \"m\" > number > string, written: " + r);
  try { r = show(derived.by(any(any(H[3]) as number) as string)) } catch (e) { r = failure(e) } console.log("super[key], \"m\" > number > string, hidden:  " + r);
  try { r = show(derived.by(any(any("m") as boolean) as string)) } catch (e) { r = failure(e) } console.log("super[key], \"m\" > boolean > string, written: " + r);
  try { r = show(derived.by(any(any(H[3]) as boolean) as string)) } catch (e) { r = failure(e) } console.log("super[key], \"m\" > boolean > string, hidden:  " + r);
  try { r = show(derived.by(any("m") as string)) } catch (e) { r = failure(e) } console.log("super[key], \"m\" > string, written: " + r);
  try { r = show(derived.by(any(H[3]) as string)) } catch (e) { r = failure(e) } console.log("super[key], \"m\" > string, hidden:  " + r);
  try { r = show(toFixedOf(any("7") as number, "7")) } catch (e) { r = failure(e) } console.log("n.toFixed.call(text), written: " + r);
  try { r = show(toFixedOf(any(H[4]) as number, H[4])) } catch (e) { r = failure(e) } console.log("n.toFixed.call(text), hidden:  " + r);
}
