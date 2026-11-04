// As fields-under-keys-behind-what-nobody-takes. What nobody takes reads a member: `Math.PI`, which `bun build` has on its list of reads that do nothing, or a member of an enum, whose value it has.
// Todo: the build's picture of what `bun build` leaves out (src/sema/fold/removed_by_bun_run.rs) knows neither that list nor the members of enums: the fields of these five classes are defined.
// Reference: bun build --compile
// @ts-nocheck
enum Numbers { one = 21 }
const KEY = "text";
let calls = 0;
globalThis.someGlobal2 = 5;
function call() { calls++; return 1; }
let local = 1;
local = 2;
const list = [1], holder = { x: 1 };
const hits = [];
class Above {}
Object.setPrototypeOf(Above.prototype, new Proxy({}, {
  set(target, key) {
    hits.push(String(key));
    return true;
  },
}));
const found = [];
function show(name, made) {
  found.push(name + "=" + (hits.length ? "assigned" : "defined") + ":" + (hits.pop() ?? Object.keys(made)[0]) + (calls ? " calls " + calls : ""));
  calls = 0;
}
class C_typeOfPi extends Above { [typeof Math.PI ? "a" : "b"] = 1; }
show("typeOfPi", new C_typeOfPi());
class C_voidPi extends Above { [void Math.PI ? "a" : "b"] = 1; }
show("voidPi", new C_voidPi());
class C_listOfPi extends Above { [[Math.PI] ? "a" : "b"] = 1; }
show("listOfPi", new C_listOfPi());
class C_typeOfMemberOfEnum extends Above { [typeof Numbers.one ? "a" : "b"] = 1; }
show("typeOfMemberOfEnum", new C_typeOfMemberOfEnum());
class C_listOfMemberOfEnum extends Above { [[Numbers.one] ? "a" : "b"] = 1; }
show("listOfMemberOfEnum", new C_listOfMemberOfEnum());
console.log(found.join("\n"));
