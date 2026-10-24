// The members of a literal that stand behind an accessor, a computed key, a spread, a call or a name that is no field are own properties like the others: JSON.stringify, Object.keys, Reflect.ownKeys and for-in list them.
const tag = Symbol("tag");
const show = (title, o) => console.log(title, JSON.stringify(o), Object.keys(o).join(), Reflect.ownKeys(o).map(String).join(), Object.entries(o).length);
function spread(rest) { return { a: 1, ...rest, b: 2 }; }
show("spread", spread({ x: 9 }));
show("empty spread", spread({}));
show("spread over", spread({ b: 7, a: 8 }));
function computed(key) { return { a: 1, [key]: 5, b: 2 }; }
show("computed", computed("k"));
show("computed symbol", computed(tag));
show("computed same", computed("b"));
show("computed index", computed(0));
function called(f) { return { a: 1, m: f(), b: 2 }; }
show("call", called(() => 3));
function getter() { return { a: 1, get g() { return 4; }, b: 2 }; }
show("getter", getter());
function method() { return { a: 1, m() { return 4; }, b: 2 }; }
show("method", method());
function proto(p) { return { a: 1, __proto__: p, b: 2 }; }
show("proto", proto({ inherited: 1 }));
function numeric() { return { a: 1, 1.5: 5, b: 2 }; }
show("numeric", numeric());
function nested(rest) { return { a: { c: 1, ...rest, d: 2 }, ...rest, b: { e: 1, [tag]: 2, f: 3 } }; }
show("nested", nested({ x: 9 }));
const direct = { a: 1, ...{ x: 9 }, b: 2 };
console.log(JSON.stringify(direct), Object.keys(direct).join());
const directComputed = { a: 1, [tag]: 2, b: 3 };
console.log(JSON.stringify(directComputed), Object.keys(directComputed).join());
for (const k in directComputed) console.log("for in", k);
console.log(JSON.stringify({ ...directComputed }), JSON.stringify(Object.assign({}, directComputed)));
