// answers: without-library
// # the range that a builder takes in the place of a piece is the piece: bounds that are negative, in the wrong order, fractions, NaN, infinite, at and behind the end; strings that are empty, wide, ropes, long; a piece that the text begins with; a piece that is read behind the append
// # the digits that a builder writes in the place of a text are the text: -0, NaN, the infinities, fractions, exponents, integers beyond 32 and 53 bits. Another radix than ten, one that is refused, String() of nothing and of whatever has text by itself
// # f3 = pairs, f4 = slices, f5 = substrings, f6 = substrs, f7 = tails, f8 = letters, f9 = halves, f10 = found, f11 = begun, f12 = kept, f13 = texts, f14 = tens, f1 = radix, f15 = sixteen, f16 = strings, f17 = nothing, f2 = described, f18 = tell
// # RUN(FORM): walk f3 mechanisms=all
// # FORM-LABEL: code f3:Body
// # FORM: StringBuilderAppendStringRange
// # RUN(BOUNDS): walk f4 mechanisms=all
// # BOUNDS-LABEL: code f4:Body
// # BOUNDS: StringBuilderAppendStringRange
// # RUN(SWAPPED): walk f5 mechanisms=all
// # SWAPPED-LABEL: code f5:Body
// # SWAPPED: StringBuilderAppendStringRange
// # RUN(DIGITS): walk f13 mechanisms=all
// # DIGITS-LABEL: code f13:Body
// # DIGITS: StringBuilderAppend
// # RUN(DIGITSONLY): walk f13 mechanisms=all
// # DIGITSONLY-NOT: StringBuilderAppendString
// # RUN(TENS): walk f14 mechanisms=all
// # TENS-LABEL: code f14:Body
// # TENS: StringBuilderAppendNumber
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 84 of 84 of 84
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO1: 84 of 84 of 84
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function pairs(line: string, n: number) { let s = ""; for (let i = 0; i < n; i++) s += line.slice(i, i + 2); return s; }
function slices(line: string, from: number, to: number, n: number) { let s = ""; for (let i = 0; i < n; i++) s += line.slice(from + i, to) + "|"; return s; }
function substrings(line: string, from: number, to: number, n: number) { let s = ""; for (let i = 0; i < n; i++) s += line.substring(from + i, to) + "|"; return s; }
function substrs(line: string, from: number, count: number, n: number) { let s = ""; for (let i = 0; i < n; i++) s += line.substr(from + i, count) + "|"; return s; }
function tails(line: string, n: number) { let s = ""; for (let i = 0; i < n; i++) s += line.slice(i) + ";"; return s; }
function letters(line: string, from: number, to: number) { let s = "["; for (let i = from; i < to; i++) s += line.charAt(i); return s + "]"; }
function halves(line: string, from: number, to: number) { let s = "["; for (let i = from; i < to; i += 0.5) s += line.charAt(i); return s + "]"; }
function found(line: string, from: number, to: number) { let s = "["; for (let i = from; i < to; i++) s += line.at(i); return s + "]"; }
function begun(line: string, from: number, n: number) { let s = line.slice(from); for (let i = 0; i < n; i++) s += "x"; return s; }
function kept(line: string, n: number) { let s = ""; let last = ""; for (let i = 0; i < n; i++) { last = line.slice(i, i + 2); s += last; } return s + "/" + last; }
function texts(n: number) { let s = ""; for (let i = 0; i < n; i++) s += i.toString() + ","; return s; }
function tens(x: number, n: number) { let s = ""; for (let i = 0; i < n; i++) s += (x * (i + 1)).toString(10) + ";"; return s; }
function radix(x: number, r: number, n: number) { let s = ""; for (let i = 0; i < n; i++) s += (x * (i + 1)).toString(r) + ";"; return s; }
function sixteen(n: number) { let s = ""; for (let i = 0; i < n; i++) s += (i * 7).toString(16); return s; }
function strings(x: number | string | boolean | null | undefined, n: number) { let s = ""; for (let i = 0; i < n; i++) s += String(x) + ";"; return s; }
function nothing(n: number) { let s = "<"; for (let i = 0; i < n; i++) s += String(); return s + ">"; }
function described(x: symbol | number, n: number) { let s = ""; for (let i = 0; i < n; i++) s += String(i ? x : i) + ";"; return s; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report("caught " + (e as Error).name); } }
const rope = pairs("abcdef", 3) + texts(4);
const long = texts(60);
report(pairs("", 3));
report(pairs("a", 3));
report(pairs("abcdef", 0));
report(pairs("abcdef", 8));
report(pairs("aĀbé", 5));
report(pairs(rope, 12));
report(pairs(long, 120).length);
report(slices("abcdef", 1, 4, 2));
report(slices("abcdef", 4, 1, 2));
report(slices("abcdef", -3, -1, 2));
report(slices("abcdef", -1, -3, 2));
report(slices("abcdef", -99, 99, 1));
report(slices("abcdef", 1.5, 3.9, 1));
report(slices("abcdef", NaN, 2, 1));
report(slices("abcdef", 2, NaN, 1));
report(slices("abcdef", 6, 6, 1));
report(slices("abcdef", 7, 9, 1));
report(slices("abcdef", -Infinity, Infinity, 1));
report(slices("abcdef", -0, 1, 1));
report(slices("", 0, 1, 2));
report(substrings("abcdef", 1, 4, 2));
report(substrings("abcdef", 4, 1, 2));
report(substrings("abcdef", -3, 2, 1));
report(substrings("abcdef", 2, -3, 1));
report(substrings("abcdef", NaN, 99, 1));
report(substrings("abcdef", 1.5, 3.9, 1));
report(substrings("abcdef", 6, 6, 1));
report(substrs("abcdef", 1, 2, 2));
report(substrs("abcdef", -2, 5, 1));
report(substrs("abcdef", 2, 0, 1));
report(substrs("abcdef", 2, -1, 1));
report(substrs("abcdef", 9, 2, 1));
report(substrs("abcdef", 1, NaN, 1));
report(substrs("abcdef", 1, Infinity, 1));
report(tails("abc", 5));
report(tails("Āé", 3));
report(letters("abc", 0, 3));
report(letters("abc", -2, 5));
report(letters("", 0, 2));
report(letters("aĀ\ud800", 0, 3).length);
report(letters(rope, 0, 12));
report(halves("abc", -1, 4));
report(found("abc", -4, 4));
report(begun("abcdef", 2, 0));
report(begun("abcdef", 2, 2));
report(begun("abcdef", 9, 2));
report(begun("abcdef", 0, 0));
report(begun(long, 3, 1).length);
report(kept("abcdef", 0));
report(kept("abcdef", 4));
report(texts(0));
report(texts(12));
report(long.length);
report(tens(0, 1));
report(tens(-0, 1));
report(tens(NaN, 1));
report(tens(-Infinity, 1));
report(tens(0.1, 2));
report(tens(-1.5, 1));
report(tens(1e21, 1));
report(tens(1e-7, 1));
report(tens(2147483648, 1));
report(tens(-2147483649, 1));
report(tens(9007199254740993, 1));
report(radix(255, 10, 1));
report(radix(255, 16, 2));
report(radix(255, 2, 1));
report(radix(-0.5, 2, 1));
tell(() => radix(255, 1, 1));
tell(() => radix(255, 37, 1));
tell(() => radix(255, 37, 0));
report(sixteen(9));
report(strings(1, 2));
report(strings(-0, 1));
report(strings("t", 2));
report(strings("", 2));
report(strings(true, 1));
report(strings(null, 1));
report(strings(undefined, 1));
report(nothing(3));
tell(() => described(4, 3));
tell(() => described(Symbol("s"), 3));
tell(() => described(Symbol(), 2));
report("end");
