// `declare`: no field is defined where the object is made: the property is missing until somebody stores it.
class Links { flags = 0; declare type?: string; declare target?: Links; size() { return 1; } }
interface Options { name: string; limit?: number; label?: string }
// A call in a loop enters each: what a loop calls repeats what it writes, and there the reads get their typed form. The loop below never turns.
const again = Number(process.argv.length > 99);
function typeOf(l: Links): unknown { return l.type; }
function truth(l: Links): unknown { return l.type ? "there" : "not there"; }
function targetOf(l: Links): unknown { return l.target; }
function three(l: Links): unknown { return [l.type, l.target === undefined, l.flags].join(); }
function limitOf(o: Options): unknown { return o.limit; }
function labelOf(o: Options): unknown { return o.label; }
function fill(l: Links) { l.type = "filled"; l.target = l; return l; }
// Each is called by value, so that each stands as a body of its own.
const readsOfLinks: ((l: Links) => unknown)[] = [typeOf, truth, targetOf, three];
const readsOfOptions: ((o: Options) => unknown)[] = [limitOf, labelOf];
for (let i = 0; i < again; i++) { const l = new Links(), o: Options = { name: "never" }; typeOf(l); truth(l); targetOf(l); three(l); limitOf(o); labelOf(o); }
function show(l: Links) { return JSON.stringify(readsOfLinks.map(read => { const found = read(l); return found instanceof Links ? "a Links" : String(found); })); }
function showOptions(o: Options) { return JSON.stringify(readsOfOptions.map(read => String(read(o)))); }
console.log(show(fill(new Links())));
const l = new Proxy(new Links(), { get(t, k, r) { return k === "type" ? "trapped" : Reflect.get(t, k, r); } });
for (let i = 0; i < 3; i++) console.log(show(l));
export {};
