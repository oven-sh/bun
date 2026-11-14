// Prints where a stack trace places a store or a deletion that only strict code refuses, and a deletion in front of a closing parenthesis.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("fail");
}
function Made() {}
const nothing = null;
const missing = undefined;
const symbol = Symbol("symbol");
const holder = { a: null, f: 5, s: "text", arr: [1], nested: { deep: null }, g() { return { h: 1 }; } };
let five = 5;
let key = "nope";
const inThisFile = /stack-positions-stores-deletions-strict/;
function placesOf(error) {
  return String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
}
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).slice(0, -2).join(" "));
  }
}
show("\"use strict\"; const each = Object.freeze({ a: 1 }); pass(each); each.a = 2;", () => { "use strict"; const each = Object.freeze({ a: 1 }); pass(each); each.a = 2; });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); each.a = 2; pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); each.a = 2; pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); pass(each.a = 2); pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); pass(each.a = 2); pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); each.a += 2; pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); each.a += 2; pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); each.a++; pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); each.a++; pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); each[\"a\"] = 2; pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); each["a"] = 2; pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); each[key] = 2; pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); each[key] = 2; pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); each.b = 2; pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); each.b = 2; pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); delete each.a; pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); delete each.a; pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); pass(delete each.a); pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); pass(delete each.a); pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); delete each[\"a\"]; pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); delete each["a"]; pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: { b: 1 } })); each.a.b = 2; each.a = 3; pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: { b: 1 } })); each.a.b = 2; each.a = 3; pass(each); });
show("\"use strict\"; const each = pass(Object.freeze([1])); each[0] = 2; pass(each);", () => { "use strict"; const each = pass(Object.freeze([1])); each[0] = 2; pass(each); });
show("\"use strict\"; const each = pass(Object.freeze([1])); each.push(2); pass(each);", () => { "use strict"; const each = pass(Object.freeze([1])); each.push(2); pass(each); });
show("\"use strict\"; const each = pass(Object.freeze([1])); each.length = 0; pass(each);", () => { "use strict"; const each = pass(Object.freeze([1])); each.length = 0; pass(each); });
show("\"use strict\"; const each = pass({ get a() { return 1; } }); each.a = 2; pass(each);", () => { "use strict"; const each = pass({ get a() { return 1; } }); each.a = 2; pass(each); });
show("\"use strict\"; const each = pass({ w: { get a() { return 1; } } }); each.w.a = 2; pass(each);", () => { "use strict"; const each = pass({ w: { get a() { return 1; } } }); each.w.a = 2; pass(each); });
show("\"use strict\"; const each = pass({ w: Object.freeze({ a: 1 }) }); each.w.a = pass(2); pass(each);", () => { "use strict"; const each = pass({ w: Object.freeze({ a: 1 }) }); each.w.a = pass(2); pass(each); });
show("\"use strict\"; const each = pass({ w: Object.freeze({ a: 1 }) }); pass(1, each.w.a = 2); pass(each);", () => { "use strict"; const each = pass({ w: Object.freeze({ a: 1 }) }); pass(1, each.w.a = 2); pass(each); });
show("\"use strict\"; undeclaredName = 1;", () => { "use strict"; undeclaredName = 1; });
show("\"use strict\"; pass(undeclaredName = 1);", () => { "use strict"; pass(undeclaredName = 1); });
show("\"use strict\"; undeclaredName += 1;", () => { "use strict"; undeclaredName += 1; });
show("\"use strict\"; holder.s.x = 1;", () => { "use strict"; holder.s.x = 1; });
show("\"use strict\"; five.x = 1;", () => { "use strict"; five.x = 1; });
show("\"use strict\"; symbol.x = 1;", () => { "use strict"; symbol.x = 1; });
show("\"use strict\"; pass(five).x = 1;", () => { "use strict"; pass(five).x = 1; });
show("\"use strict\"; Object.defineProperty(Object.freeze({}), \"a\", { value: 1 });", () => { "use strict"; Object.defineProperty(Object.freeze({}), "a", { value: 1 }); });
show("\"use strict\"; Object.preventExtensions(holder.nested2 = {}); holder.nested2.z = 1;", () => { "use strict"; Object.preventExtensions(holder.nested2 = {}); holder.nested2.z = 1; });
show("\"use strict\"; class A { static get g() { return 1; } } A.g = 2;", () => { "use strict"; class A { static get g() { return 1; } } A.g = 2; });
show("\"use strict\"; class A { get g() { return 1; } } new A().g = 2;", () => { "use strict"; class A { get g() { return 1; } } new A().g = 2; });
show("\"use strict\"; class A { get g() { return 1; } m() { this.g = 2; } } new A().m();", () => { "use strict"; class A { get g() { return 1; } m() { this.g = 2; } } new A().m(); });
show("\"use strict\"; class A { constructor() { Object.freeze(this); } m() { this.x = 2; } } new A().m();", () => { "use strict"; class A { constructor() { Object.freeze(this); } m() { this.x = 2; } } new A().m(); });
show("\"use strict\"; class A { x = 1; constructor() { Object.freeze(this); } m() { this.x = 2; } } new A().m();", () => { "use strict"; class A { x = 1; constructor() { Object.freeze(this); } m() { this.x = 2; } } new A().m(); });
show("\"use strict\"; class A { x = 1; constructor() { Object.freeze(this); } m() { this.x++; } } new A().m();", () => { "use strict"; class A { x = 1; constructor() { Object.freeze(this); } m() { this.x++; } } new A().m(); });
show("\"use strict\"; class A { x = 1; constructor() { Object.freeze(this); } m() { return this.x = pass(2); } } new A().m();", () => { "use strict"; class A { x = 1; constructor() { Object.freeze(this); } m() { return this.x = pass(2); } } new A().m(); });
show("\"use strict\"; Math.PI = 3;", () => { "use strict"; Math.PI = 3; });
show("\"use strict\"; (function () { arguments.callee; })();", () => { "use strict"; (function () { arguments.callee; })(); });
show("\"use strict\"; (function () { return this.x; })();", () => { "use strict"; (function () { return this.x; })(); });
show("\"use strict\"; pass.caller;", () => { "use strict"; pass.caller; });
show("\"use strict\"; delete Object.prototype;", () => { "use strict"; delete Object.prototype; });
show("\"use strict\"; delete [].length;", () => { "use strict"; delete [].length; });
show("\"use strict\"; Object.freeze(holder.arr2 = [1, 2]); holder.arr2.sort();", () => { "use strict"; Object.freeze(holder.arr2 = [1, 2]); holder.arr2.sort(); });
show("\"use strict\"; const { a, ...rest } = pass(Object.freeze({ a: 1, b: 2 })); rest.b = 3; Object.freeze(rest).b = 4;", () => { "use strict"; const { a, ...rest } = pass(Object.freeze({ a: 1, b: 2 })); rest.b = 3; Object.freeze(rest).b = 4; });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); pass(1, delete each.a); pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); pass(1, delete each.a); pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); pass([delete each.a]); pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); pass([delete each.a]); pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); pass(delete each[\"a\"]); pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); pass(delete each["a"]); pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); pass(delete each.a, 1); pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); pass(delete each.a, 1); pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); pass(!delete each.a); pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); pass(!delete each.a); pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); pass(five && delete each.a); pass(each);", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); pass(five && delete each.a); pass(each); });
show("\"use strict\"; const each = pass(Object.freeze({ a: 1 })); return delete each.a;", () => { "use strict"; const each = pass(Object.freeze({ a: 1 })); return delete each.a; });
show("class A { m() { delete super.x; } } new A().m();", () => { class A { m() { delete super.x; } } new A().m(); });
show("class A { m() { pass(delete super.x); } } new A().m();", () => { class A { m() { pass(delete super.x); } } new A().m(); });
show("class A { m() { delete super[key]; } } new A().m();", () => { class A { m() { delete super[key]; } } new A().m(); });
show("class A { m() { delete super[\"x\"]; } } new A().m();", () => { class A { m() { delete super["x"]; } } new A().m(); });
show("pass(delete nothing.x);", () => { pass(delete nothing.x); });
show("pass(delete holder.a.b);", () => { pass(delete holder.a.b); });
