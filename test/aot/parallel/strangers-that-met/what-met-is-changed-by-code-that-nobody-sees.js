const a = { name: "a", one: 1 };
const b = { name: "b", two: 2 };
const c = { name: "c", three: 3 };
const d = { four: 4, name: "d" };
const e = { name: "e", five: 5 };
const f = { name: "f", six: 6 };
const all = [a, b, c, d, e, f];
function nameOf(o) { return o.name; }
function extraOf(o) { return o.extra; }
let text = "";
for (const o of all) text += nameOf(o) + String(extraOf(o)) + " ";
const change = eval("(list => { delete list[0].name; list[1].name = 7; list[2].extra = 'x'; Object.defineProperty(list[3], 'name', { get() { return 'got'; } }); Object.setPrototypeOf(list[4], { extra: 'above' }); Object.freeze(list[5]); list.push({ name: 'late' }, Object.create({ name: 'inherited' }), 'text', 5); })");
change(all);
for (const o of all) text += String(nameOf(o)) + String(extraOf(o)) + " ";
console.log(text);
