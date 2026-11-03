// `value instanceof bound` asks the target of the bound function in its place: for its method under Symbol.hasInstance, and else for its prototype property. Nothing else in the program leads to what runs then.
function ask(value, ctor) { return value instanceof ctor; }
let calls = 0;
const D = () => {};
Object.defineProperty(D, Symbol.hasInstance, { value(value) { calls++; return value === 1; } });
const held = JSON.parse('{"list":[]}');
held.list.push(D.bind());
try { console.log("out of parsed data", ask(1, held.list[0]), ask(2, held.list[0]), calls); } catch (e) { console.log("threw", String(e).slice(0, 70)); }
