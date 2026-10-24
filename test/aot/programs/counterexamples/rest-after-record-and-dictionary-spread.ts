// `{ ...record, ...dictionary }` keeps the extra properties in an object without a prototype. Its structure must not be handed to an ordinary object that has the same names.
interface R0 { h: boolean }
function make0(k: number): R0 { switch (k % 3) { case 0: return { h: k % 2 === 0 }; case 1: return { h: k % 2 === 0 }; default: return { h: true }; } }
function merge(k: number): R0 {
  const r = make0(k);
  const d: Record<string, any> = { w: { q: 1 } };
  return ((): R0 => ({ ...{ ...r }, ...d } as R0))();
}
function rest(o: any): any { const { a, ...others } = o; return others; }
function copy(o: any): any { return { ...o }; }
function extend(o: any, v: number): any { return { ...o, w: v }; }
function tell(what: string, got: any): void { console.log(what, Object.getPrototypeOf(got) === Object.prototype, typeof got.toString, got instanceof Object, Object.keys(got).join()); }
for (let k = 0; k < 7; k++) merge(k);
tell("rest", rest({ a: 1, w: 2 }));
tell("copy", copy({ w: 2 }));
tell("extend", extend({}, 2));
tell("literal", { w: 2 });
const built: any = {}; built.w = 1;
tell("rest of built", rest(Object.assign(built, { a: 1 })));
tell("merged", merge(1));
