// Objects as keys of own, inherited and missing names: in, hasOwn, hasOwnProperty in loops.
class Key { constructor(public name: any) {} toString() { return this.name; } }
class Base { own = 1; get seen() { return 2; } method() { return 3; } }
class Sub extends Base { more = 4; }
const keys = ["own", "seen", "method", "more", "missing", "toString", "constructor", "0"].map(n => new Key(n)) as any[];
const objects: any[] = [new Base(), new Sub(), { own: 1 }, Object.create({ own: 2, seen: 3 }), [1], Object.assign(Object.create(null), { more: 1 })];
for (let t = 0; t < 3; t++) for (const key of keys) {
  let r = key.name + " "; for (const o of objects) r += Number(key in o) + "" + Number(Object.hasOwn(o, key)) + Number(Object.prototype.hasOwnProperty.call(o, key)) + (o[key] === undefined ? "u" : "v") + " ";
  console.log(r); if (t === 1) delete objects[2].own;
}
