const make = () => ({ count: 0, text: "a", link: null });
const makeWide = () => {
  const made = {};
  for (let i = 0; i < 12; i++) made["p" + i] = i;
  made.count = 0;
  return made;
};
function Maker(a) {
  this.a = a;
}
Maker.prototype.count = 0;
class Base {
  static count = 0;
}
class Heir extends Base {}
export const lone = [make(), make(), make(), make()];
export const parents = [make(), make(), make(), make()];
export const heirs = parents.map(parent => Object.create(parent));
export const wideParents = [makeWide(), makeWide(), makeWide(), makeWide()];
export const heirsOfWideParents = wideParents.map(parent => Object.create(parent));
export const prototypes = [Maker.prototype, Maker.prototype, Maker.prototype, Maker.prototype];
export const made = [new Maker(1), new Maker(2)];
export const classes = [Base, Base, Base, Base];
export const heirsOfClasses = [Heir];
export function theLoopAlone(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3] !== undefined) s++;
  return s;
}
export function storesNumber(list, n) {
  for (let i = 0; i < n; i++) list[i & 3].count = i;
  return list[0].count;
}
export function storesObject(list, n, v) {
  for (let i = 0; i < n; i++) list[i & 3].link = v;
  return list[0].link === v;
}
export function storesByKey(list, n) {
  for (let i = 0; i < n; i++) list[i & 3][i & 4 ? "count" : "text"] = i;
  return list[0].count;
}
export function readsNumber(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3].count !== undefined) s++;
  return s;
}
