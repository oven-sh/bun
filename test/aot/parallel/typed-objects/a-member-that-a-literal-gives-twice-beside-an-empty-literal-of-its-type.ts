// `{ ...{ f: x }, ...{ f: y } }.f` is y. Beside `const nb: { f?: number } = {}` the two literals share a type, and the read gave x wherever the build knew x.
function twoSpreads(x: number, y: number): number {
  const o = { ...{ f: x }, ...{ f: y } };
  const nb: { f?: number } = {};
  return o.f;
}
function secondIsUnknown(x: number, y: number): number {
  const o = { ...{ g: x }, ...{ g: y } };
  const nb: { g?: number } = {};
  return o.g;
}
function spreadThenMember(x: number, y: number): number {
  const o = { ...{ h: x }, h: y };
  const nb: { h?: number } = {};
  return o.h;
}
function memberThenSpread(x: number, y: number): number {
  // @ts-ignore
  const o = { i: x, ...{ i: y } };
  const nb: { i?: number } = {};
  return o.i;
}
function memberTwice(x: number, y: number): number {
  // @ts-ignore
  const o = { j: x, j: y };
  const nb: { j?: number } = {};
  return o.j;
}
function threeSpreads(x: number, y: number, z: number): number {
  const o = { ...{ k: x }, ...{ k: y }, ...{ k: z } };
  const nb: { k?: number } = {};
  return o.k;
}
function twoMembers(x: number, y: number): string {
  const o = { ...{ l: x, m: "a" }, ...{ m: "b", l: y } };
  const nb: { l?: number; m?: string } = {};
  return o.l + o.m;
}
function booleans(x: boolean, y: boolean | undefined) {
  const o = { ...{ n: x }, ...{ n: y } };
  const nb: { n?: boolean } = {};
  return o.n;
}
function falseThenUndefined() {
  const o = { ...{ p: false }, p: undefined };
  const nb: { p?: boolean } = {};
  return o.p;
}
function strings(x: string, y: string) {
  const o = { ...{ q: x }, ...{ q: y } };
  const nb: { q?: string } = {};
  return o.q;
}
function sameValueTwice(x: number, y: number): number {
  const o = { ...{ r: x }, ...{ r: y } };
  const nb: { r?: number } = {};
  return o.r;
}
function behindAComputedKey(x: number, y: number, key: string) {
  const o = { ...{ s: x }, [key]: 0, s: y };
  const nb: { s?: number } = {};
  return o.s;
}
function kept(x: number, y: number) {
  const o = { ...{ t: x }, ...{ t: y } };
  return o;
}
const emptyBesideKept: { t?: number } = {};
console.log(twoSpreads(7, 8), secondIsUnknown(7, Date.now() * 0 + 8), spreadThenMember(7, 8), memberThenSpread(7, 8), memberTwice(7, 8));
console.log(threeSpreads(7, 8, 9), twoMembers(7, 8), booleans(false, true), booleans(false, undefined), falseThenUndefined(), strings("first", "second"));
console.log(sameValueTwice(7, 7), behindAComputedKey(7, 8, "other"), behindAComputedKey(7, 8, "s"));
const list = [kept(7, 8), kept(7, 8)];
console.log(list[0].t, list[1].t, emptyBesideKept.t, JSON.stringify(list), Object.keys(list[0]).join());
