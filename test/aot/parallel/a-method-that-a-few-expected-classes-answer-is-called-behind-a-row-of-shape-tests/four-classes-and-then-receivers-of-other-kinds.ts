// STATISTIC: SpeculatedReceiversDispatchedByShape >= 2
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
interface Spec { kind: string; a: number; b: number }
interface Figure { area(): number; grow(by: number): void }
class Disk implements Figure { constructor(private r: number) {} area(): number { return this.r * this.r * 3; } grow(by: number): void { this.r += by; } }
class Slab implements Figure { constructor(private w: number, private h: number) {} area(): number { return this.w * this.h; } grow(by: number): void { this.w += by; } }
class Wedge implements Figure { constructor(private w: number, private h: number) {} area(): number { return (this.w * this.h) / 2; } grow(by: number): void { this.h += by; } }
class Dash implements Figure { constructor(private long: number) {} area(): number { return 0; } grow(by: number): void { this.long += by; } }
function make(spec: Spec): Figure { return spec.kind === "disk" ? new Disk(spec.a) : spec.kind === "slab" ? new Slab(spec.a, spec.b) : spec.kind === "wedge" ? new Wedge(spec.a, spec.b) : new Dash(spec.a); }
function total(figures: Figure[], by: number): number { let sum = 0; for (const figure of figures) { figure.grow(by); sum += figure.area(); } return sum; }
const specs: Spec[] = JSON.parse("[" + Array.from({ length: 12 }, (_, i) => '{"kind":"' + ["disk", "slab", "wedge", "dash"][i % 4] + '","a":' + (i + 1) + ',"b":' + (i % 3 + 2) + "}").join() + "]");
const door: string = JSON.parse('"zqdoor"');
const throughTheDoor = (list: unknown[], by: number): unknown => { (globalThis as any)[door] = list; return (globalThis as any).zqcall((globalThis as any)[door], by); };
(globalThis as any)[JSON.parse('"zqcall"')] = total;
const figures = specs.map(make);
const mixed: unknown[] = [...figures];
const say = (word: string): void => { let said: string; try { said = String(throughTheDoor(mixed, 0.5)); } catch (e) { said = (e as Error).name; } console.log(word, said, total(figures, 0)); };
say("as made");
say("again");
const [AREA, GROW]: string[] = JSON.parse('["area","grow"]');
const loose: any = {};
loose[AREA!] = () => 1000;
loose[GROW!] = () => {};
mixed.push(loose);
say("an ordinary object with the names");
mixed.push(Object.create(make(specs[0]!)));
say("an object laid below one of the four");
const shadowed: any = make(specs[1]!);
shadowed.area = () => -5;
mixed.push(shadowed);
say("an object that hides the method");
(Disk.prototype as any)[JSON.parse('"area"')] = function () { return 7; };
say("a method replaced on its class");
Object.setPrototypeOf(mixed[1] as object, Dash.prototype);
say("one object laid below another class");
mixed.push(new Proxy(make(specs[2]!), {}));
say("a proxy");
Object.defineProperty(Wedge.prototype, "grow", { get() { return function (this: any) { this.h = 1; }; } });
say("a getter in place of a method");
mixed.splice(3, 0, null);
say("null among them");
