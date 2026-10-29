// `Object.assign` onto a target that has an accessor for an index key calls the setter for every source, as the specification says.
const target = () => ({ get 1() { return 5; }, set 1(v) {} });
console.log("one plain source", Object.assign(target(), { 1: "x" })[1]);
console.log("behind a getter source (row 129)", Object.assign(target(), { get b() { return 1; } }, { 1: "x" })[1]);
console.log("two plain sources", Object.assign(target(), { a: 1 }, { 1: "x" })[1]);
console.log("an array source", Object.assign(target(), ["a", "x"])[1]);
const named = () => ({ get p() { return 5; }, set p(v) {} });
console.log("a named accessor", Object.assign(named(), { p: "x" }).p, Object.assign(named(), { get b() { return 1; } }, { p: "x" }).p);
const readOnly = () => Object.defineProperty({}, 1, { value: 5, writable: false, configurable: true });
try { "use strict"; console.log("a read-only index", Object.assign(readOnly(), { 1: "x" })[1]); } catch (e) { console.log("a read-only index threw", e.constructor.name); }
// On the prototype chain: a store consults the chain. An inherited setter runs and no own property is created; an inherited read-only index makes the store fail with a TypeError. Plain Bun defines an own property.
{ const log = []; const t = Object.create({ set 1(v) { log.push("set " + v); }, get 1() { return "inherited"; } }); Object.assign(t, { 1: "x" }); console.log("a setter on the prototype", log.join(), t[1], Object.hasOwn(t, 1)); }
{ const t = Object.create(Object.defineProperty({}, 1, { value: "fixed", writable: false })); try { Object.assign(t, { 1: "x" }); console.log("a read-only index on the prototype", t[1], Object.hasOwn(t, 1)); } catch (e) { console.log("a read-only index on the prototype threw", e.constructor.name, t[1]); } }
{ const log = []; const t = Object.create(Object.create({ set 2(v) { log.push("set " + v); } })); Object.assign(t, { 2: "x" }); console.log("a setter two steps up", log.join(), Object.hasOwn(t, 2)); }
{ const log = []; const t = Object.create({ set n(v) { log.push("set " + v); } }); Object.assign(t, { n: "x" }); console.log("CONTROL: a setter at a name on the prototype", log.join(), Object.hasOwn(t, "n")); }
console.log("CONTROL: plain indexes", JSON.stringify(Object.assign({ 0: "a" }, { 1: "b" }, { 0: "c", 5: "f" })), JSON.stringify(Object.assign([1, 2, 3], { 1: "x" }, [9])));
{ const t = Object.create({ 7: "data up there" }); Object.assign(t, { 7: "x", a: 1 }); console.log("CONTROL: plain data at the index on the prototype", t[7], Object.hasOwn(t, 7), t.a); }
