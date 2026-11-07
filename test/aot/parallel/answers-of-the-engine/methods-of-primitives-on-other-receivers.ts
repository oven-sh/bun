// The source declares a text, a number or a boolean, and the method is found on the prototype object of its class where the test passes. A wrapper object, one with a property of its own under the name, an instance of a class below and a plain object answer for themselves.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
function attempt(way: () => unknown) { try { return way(); } catch (error: any) { return error.name; } }
function codeAt(s: string, i?: any) { return s.charCodeAt(i); }
function sumOfCodes(s: string) { let sum: any = 0; for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i); return sum; }
function upper(s: string) { return s.toUpperCase(); }
function firstIndex(s: string, part: any) { return s.indexOf(part); }
function piece(s: string, from: any, to: any) { return s.slice(from, to); }
function fixed(n: number) { return n.toFixed(1); }
function textOfNumber(n: number, base?: any) { return n.toString(base); }
function textOfTruth(b: boolean) { return b.toString(); }
function valueOfAny(v: any) { return v.valueOf(); }
const wrapped: any = new String("abc");
const shadowed: any = new String("abc");
shadowed.charCodeAt = () => "own";
shadowed.toUpperCase = function () { return "OWN " + this.length; };
class Text extends String { charCodeAt(i: number): any { return "below:" + super.charCodeAt(i); } }
const plain: any = { length: 2, charCodeAt(i: number) { return "plain" + i; }, toUpperCase() { return "PLAIN"; }, indexOf() { return "nowhere"; }, slice() { return "no piece"; } };
const receivers: any[] = ["abc", "", "é中", wrapped, shadowed, new Text("abc"), plain, "ab" + String(1)];
for (let r = 0; r < receivers.length; r++) { report(codeAt(receivers[r], 1)); report(sumOfCodes(receivers[r])); report(upper(receivers[r])); report(firstIndex(receivers[r], "b")); report(piece(receivers[r], 1, 2)); }
const notReceivers: any[] = [undefined, null, 5, true, 10n, Symbol("s"), {}, [], () => 1];
for (let r = 0; r < notReceivers.length; r++) { report(attempt(() => codeAt(notReceivers[r], 0))); report(attempt(() => sumOfCodes(notReceivers[r]))); report(attempt(() => upper(notReceivers[r]))); }
const positions: any[] = [undefined, null, -1, 0, 1, 2, 3, 1.7, -0.5, NaN, Infinity, -Infinity, "1", "x", true, { valueOf() { return 2; } }, [1], 4294967297];
for (let p = 0; p < positions.length; p++) { report(codeAt("abc", positions[p])); report(piece("abcdef", positions[p], 4)); report(piece("abcdef", 1, positions[p])); }
report(attempt(() => codeAt("abc", Symbol("s"))));
report(attempt(() => codeAt("abc", 1n)));
report(attempt(() => codeAt("abc", { valueOf() { throw new RangeError("asked"); } })));
report(codeAt("abc"));
const numbers: any[] = [1.25, -0, NaN, Infinity, new Number(2.5), { toFixed() { return "fixed here"; }, toString() { return "text here"; } }];
for (let n = 0; n < numbers.length; n++) { report(fixed(numbers[n])); report(textOfNumber(numbers[n])); report(attempt(() => textOfNumber(numbers[n], 2))); }
report(attempt(() => textOfNumber(5, 1)));
report(attempt(() => textOfNumber(5, 37)));
report(attempt(() => fixed("1" as any)));
report(textOfTruth(true));
report(textOfTruth(new Boolean(false) as any));
report(attempt(() => textOfTruth(undefined as any)));
report(valueOfAny("s"));
report(valueOfAny(1));
report(valueOfAny(false));
report(valueOfAny(wrapped));
report(typeof valueOfAny(plain));
report("end");
