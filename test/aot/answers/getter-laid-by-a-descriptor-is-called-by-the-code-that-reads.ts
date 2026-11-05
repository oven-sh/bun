// answers: without-library
// # `flags.n3`, where `flags` is an ordinary object on which a loop has laid closures of one function as getters, by descriptors under computed names. The code that reads looks the getter up, tests that it is a closure of that function, and calls it itself. Another function under the name, a value, a deletion and a name that was never laid go by the read as it is written.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
const names: string[] = []; for (let i = 0; i < 40; i++) names.push("n" + i);
function getterOf(name: string, weight: number, holder: object) { return function (this: unknown) { return name + ":" + weight + ":" + (this === holder ? "own" : "other"); }; }
function build(weight: number): any { const flags: any = Object.create(null); for (let k = 0; k < names.length; k++) { const name = names[k]; Object.defineProperty(flags, name, { get: getterOf(name, weight, flags), enumerable: true, configurable: true }); } return flags; }
function descriptorOf(get: unknown, set: unknown) { return { get, set, configurable: true }; }
function plain(): any { const values: any = Object.create(null); for (let k = 0; k < names.length; k++) values[names[k]] = "plain " + k; return values; }
const flags = build(1);
const others = build(2);
let current = flags;
function three() { return current.n3 + " " + current.n17 + " " + current.n39; }
function missing() { return String(current.nothing); }
function attempt() { try { return three(); } catch (e) { return e instanceof RangeError ? "RangeError" : e instanceof TypeError ? "TypeError" : "other error"; } }
function warm(of: any) { current = of; let last = ""; for (let i = 0; i < 300; i++) last = attempt(); return last; }
report(warm(flags));
report(warm(others));
report(missing()); // @ts-expect-error
Object.defineProperty(flags, "n17", descriptorOf(function () { return "another function"; }, undefined));
report(warm(flags));
report(warm(others));
Object.defineProperty(flags, "n3", { value: "a value", writable: true, configurable: true });
report(warm(flags));
delete flags.n39;
report(warm(flags)); // @ts-expect-error
Object.defineProperty(flags, "n39", descriptorOf(undefined, function (v: unknown) {}));
report(warm(flags)); // @ts-expect-error
Object.defineProperty(others, "n3", descriptorOf(getterOf("moved", 3, flags), undefined));
report(warm(others)); // @ts-expect-error
Object.defineProperty(others, "n39", descriptorOf(function () { throw new RangeError("thrown"); }, undefined));
report(warm(others));
report(warm(Object.create(build(4))));
report(warm(plain()));
report(warm(build(5)));
report("end");
declare function report(value: unknown): void;
