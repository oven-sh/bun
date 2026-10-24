// Classes whose base is the value of an expression inherit typed fields. Values of other types reach those fields in every untyped way, on them and on the base class, and untyped reads get them back.
const names: string[] = JSON.parse('["x", "y"]');
const parsed: any = JSON.parse('{"x": "parsed", "y": 7}');
class P {
  x: number = 1;
  y: string = "s";
  sum(): number {
    return this.x + 1;
  }
}
type Constructor<T> = new (...a: any[]) => T;
const Mix = <B extends Constructor<P>>(b: B) => class extends b { w: number = 4; };
const Again = <B extends Constructor<P>>(b: B) => class extends b { v: number = 5; };
function pick<T>(c: T): T {
  return c;
}
const M = Mix(P);
const MM = Again(Mix(P));
const Picked = pick(P);
class FromPicked extends Picked {
  u: number = 6;
}
class FromCondition extends (names.length > 1 ? P : P) {
  t: number = 7;
}
function show(o: object): string {
  const a = o as any;
  return typeof a.x + ":" + String(a.x) + " " + typeof a.y + ":" + String(a.y) + " " + Object.keys(o).join("+") + " " + JSON.stringify(o);
}
function putByName(o: any): void {
  o.x = "by name";
}
function putWider(o: { x: number | string }): void {
  o.x = "wider";
}
function putByKey(o: any): void {
  o[names[0]] = "by key";
  o[names[1]] = 8;
}
function copy(o: any): void {
  for (const k of Object.keys(parsed)) o[k] = parsed[k];
}
function restore(p: P): number {
  p.x = 2;
  p.y = "t";
  return p.sum();
}
const makers: (() => P)[] = [() => new M(), () => new MM(), () => new FromPicked(), () => new FromCondition(), () => new P()];
const actions: ((o: any) => void)[] = [putByName, putWider, putByKey, copy, o => Object.assign(o, parsed), o => Reflect.set(o, names[0], null), o => { delete o.x; }, o => Object.defineProperty(o, "x", { value: "defined", writable: true, enumerable: true, configurable: true })];
for (const make of makers) {
  for (const act of actions) {
    const untouched = make();
    const o = make();
    act(o);
    console.log(show(o), "|", restore(o), show(o), "|", untouched.sum(), show(untouched));
  }
}
