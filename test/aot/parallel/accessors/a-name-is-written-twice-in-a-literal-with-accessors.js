// A name stands twice in a literal, as a getter and a getter, a field and a getter, a getter and a field, a getter and a setter with a field between: the later definition wins, and the name keeps its first place among the keys.
function show(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + (d.get ? "g" : "") + (d.set ? "s" : "") + ("value" in d ? "v" + String(d.value) : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + (d.writable ? "w" : ""); }).join(" "); }
function twice(i) { return { get a() { return i; }, get a() { return i + 1; } }; }
function fieldThenGetter(i) { return { a: 1, z: 2, get a() { return i; } }; }
function getterThenField(i) { return { get a() { return i; }, z: 2, a: 5 }; }
function setterThenGetterThenSetter(i) { let seen = 0; return { set a(n) { seen = n; }, get a() { return seen + i; }, set a(n) { seen = n * 2; } }; }
function getterThenFieldThenSetter(i) { return { get a() { return i; }, a: 5, set a(n) { i = n; } }; }
const makers = [twice, fieldThenGetter, getterThenField, setterThenGetterThenSetter, getterThenFieldThenSetter];
for (const make of makers) for (let i = 1; i < 3; i++) { const o = make(i); let said = "stored"; try { o.a = 4; } catch (error) { said = error.constructor.name; } console.log(make.name, said, show(o), o.a, JSON.stringify(o)); }
let sum = 0;
for (let i = 0; i < 300; i++) { const s = setterThenGetterThenSetter(i); s.a = 3; sum += twice(i).a + fieldThenGetter(i).a + getterThenField(i).a + s.a + (getterThenFieldThenSetter(i).a === undefined ? 1 : 0); }
console.log("sum", sum);
