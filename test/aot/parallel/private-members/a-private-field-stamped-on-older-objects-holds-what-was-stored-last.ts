// A constructor that hands back an older object stamps the private names of the class below it on that object: a table, a function, a list, a view, a proxy. None of them is a compiled object of that class.
class Base { constructor(o: object) { return o; } }
class Stamp extends Base { #mark: any = 1; static read(o: any) { return o.#mark; } static write(o: any, v: any) { o.#mark = v; } static has(o: any) { return #mark in o; } }
const things: any[] = [{}, new Map(), function () {}, [1], new Uint8Array(2), new Error("e"), Object.create(null), new Proxy({}, {})];
let out = "";
for (const thing of things) { out += Stamp.has(thing) + ","; new Stamp(thing); }
for (let turn = 0; turn < 300; turn++) for (const thing of things) Stamp.write(thing, Stamp.read(thing) + 1);
for (const thing of things) out += Stamp.read(thing) + ",";
Stamp.write(things[1], "text"); Stamp.write(things[3], { k: 1 });
for (const thing of things) out += typeof Stamp.read(thing) + ",";
try { Stamp.read({}); } catch (error: any) { out += error.constructor.name; }
try { new Stamp(things[0]); } catch (error: any) { out += error.constructor.name; }
console.log(out);
