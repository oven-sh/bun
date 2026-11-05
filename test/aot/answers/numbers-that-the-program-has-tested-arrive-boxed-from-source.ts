// answers: without-library
// # behind `typeof a === "number"`, as the front end writes it, the value is a proven number that lies boxed: a chain is walked on integers and on doubles, a sum that a return takes stays boxed, a truncation reads the tag
// # the program is that of the answers test, so what is shown here is what gives the answers there
// # f1 = mix, f3 = sum, f6 = whole, f10 = scaled
// # RUN(FORM): walk f1 mechanisms=all-ParameterGuards-Inlining
// # FORM-LABEL: code f1:Body
// # FORM: = TypeTest {{*}}testedType=i32
// # RUN(BOXED): walk f3 mechanisms=all-ParameterGuards-Inlining
// # BOXED-LABEL: code f3:Body
// # BOXED: @JSValue = Add {{*}}form=Numbers
// # RUN(TAG): walk f6 mechanisms=all-ParameterGuards-Inlining
// # TAG-LABEL: code f6:Body
// # TAG: = ToInt32
// # RUN(RAW): walk f10 mechanisms=all-ParameterGuards-Inlining
// # RAW-LABEL: code f10:Body
// # RAW: @Double = Add {{*}}form=Numbers
function mix(a: any, b: any) { if (typeof a === "number" && typeof b === "number") return (a + b) | 0; return "no numbers"; }
function chain(a: any, b: any, c: any) { if (typeof a === "number" && typeof b === "number" && typeof c === "number") return ((a + b) * c - a) >>> 0; return "no numbers"; }
function sum(a: any, b: any) { if (typeof a === "number" && typeof b === "number") return a + b; return "no numbers"; }
function less(a: any, b: any) { if (typeof a === "number" && typeof b === "number") return a - b; return "no numbers"; }
function step(a: any) { if (typeof a === "number") { a++; return a; } return "no number"; }
function whole(a: any) { if (typeof a === "number") return a | 0; return "no number"; }
function unsigned(a: any) { if (typeof a === "number") return a >>> 0; return "no number"; }
function flipped(a: any) { if (typeof a === "number") return 0 ^ a; return "no number"; }
function wrap(x: any, y: any) { if (typeof x === "number" && typeof y === "number") { let s = 0; for (let i = 0; i < 3; i++) s += x % y; return s; } return "no numbers"; }
function scaled(a: any, b: any) { if (typeof a === "number" && typeof b === "number") return a * 0.5 + b; return "no numbers"; }
function total(a: any, b: any) { if (b === "none") return "none"; return Number(a) + Number(b); }
function gap(a: any, b: any) { if (b === "none") return "none"; return Number(a) - Number(b); }
function half(a: any, b: any) { if (b === "none") return "none"; return Number(a) * 0.5 + Number(b); }
function area(a: any, b: any) { if (b === "none") return "none"; const x = Number(a); return (x + Number(b)) * x; }
function show(value: unknown) { return typeof value === "number" && value === 0 ? (1 / value > 0 ? "0" : "-0") : value; }
function tell(f: () => unknown) { try { report(show(f())); } catch (e) { report((e as Error).name); } }
const numbers = JSON.parse("[0, -0, 1, -1, 7, 0.5, -0.5, 2147483647, -2147483648, 2147483648, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e21, 1e300, -1e300]");
numbers[numbers.length] = NaN;
numbers[numbers.length] = Infinity;
numbers[numbers.length] = -Infinity;
numbers[numbers.length] = "3";
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => mix(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => chain(numbers[i], numbers[j], numbers[(i + j) % numbers.length]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => sum(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => less(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => wrap(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => scaled(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => total(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => gap(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => half(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) for (let j = 0; j < numbers.length; j++) tell(() => area(numbers[i], numbers[j]));
for (let i = 0; i < numbers.length; i++) tell(() => step(numbers[i]));
for (let i = 0; i < numbers.length; i++) tell(() => whole(numbers[i]));
for (let i = 0; i < numbers.length; i++) tell(() => unsigned(numbers[i]));
for (let i = 0; i < numbers.length; i++) tell(() => flipped(numbers[i]));
tell(() => total(1, "none"));
report("end");
