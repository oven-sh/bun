// `import a = N.b` is a const: using it before the statement runs throws a ReferenceError.
namespace local { export function h() { return "h"; } export let m = 1; export const c = "c"; export class K {} }
function callsIt() { return h(); }
function readsIt() { return h; }
function readsVariable() { return m; }
function readsConstant() { return c; }
function makesOne() { return new K(); }
function asksForItsType() { return typeof m; }
const all = [callsIt, readsIt, readsVariable, readsConstant, makesOne, asksForItsType];
for (const f of all) {
  try { console.log(f.name, typeof f()); } catch (e) { console.log(f.name, (e as Error).name); }
}
import h = local.h;
import m = local.m;
import c = local.c;
import K = local.K;
for (const f of all) console.log(f.name, typeof f());
