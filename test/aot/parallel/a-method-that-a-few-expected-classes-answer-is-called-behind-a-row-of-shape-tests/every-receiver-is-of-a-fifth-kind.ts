// STATISTIC: MethodCallsOnExpectedReceiversToldApartByShape >= 2
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
const kept = specs.map(make);
const [AREA, GROW]: string[] = JSON.parse('["area","grow"]');
const others: unknown[] = specs.map(spec => { let side = spec.a; const other: any = {}; other[AREA!] = () => side * side; other[GROW!] = (by: number) => { side += by; }; return other; });
console.log(throughTheDoor(others, 1), throughTheDoor(others, 0.5), total(kept, 1), throughTheDoor(others, 2));
