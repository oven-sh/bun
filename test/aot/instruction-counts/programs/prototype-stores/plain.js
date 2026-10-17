const make = () => ({ count: 0, text: "a", link: null });
const makeWide = () => {
  const object = {};
  for (let i = 0; i < 12; i++) object["p" + i] = i;
  object.count = 0;
  return object;
};
function Maker(a) {
  this.a = a;
}
Maker.prototype.count = 0;
class Base {
  static count = 0;
}
class Derived extends Base {}
export const plainObjects = [make(), make(), make(), make()];
export const prototypeObjects = [make(), make(), make(), make()];
export const derivedObjects = prototypeObjects.map(parent => Object.create(parent));
export const widePrototypeObjects = [makeWide(), makeWide(), makeWide(), makeWide()];
export const wideDerivedObjects = widePrototypeObjects.map(parent => Object.create(parent));
export const functionPrototypes = [Maker.prototype, Maker.prototype, Maker.prototype, Maker.prototype];
export const instances = [new Maker(1), new Maker(2)];
export const baseClasses = [Base, Base, Base, Base];
export const derivedClasses = [Derived];
export function emptyLoop(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3] !== undefined) s++;
  return s;
}
export function storeNumber(list, n) {
  for (let i = 0; i < n; i++) list[i & 3].count = i;
  return list[0].count;
}
export function storeObject(list, n, v) {
  for (let i = 0; i < n; i++) list[i & 3].link = v;
  return list[0].link === v;
}
export function storeByKey(list, n) {
  for (let i = 0; i < n; i++) list[i & 3][i & 4 ? "count" : "text"] = i;
  return list[0].count;
}
export function readNumber(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3].count !== undefined) s++;
  return s;
}
