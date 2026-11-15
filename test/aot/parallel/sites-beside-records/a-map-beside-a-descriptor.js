// A map and the record that Object.getOwnPropertyDescriptor() gives meet in one variable.
// Under: --aot-testing=CheckProofsAtRunTime: the class that LinkedFunction::result, LinkedCell::proven and LinkedParameter::proven name of a site whose family holds a record that a row makes
function table(n) { const map = new Map(); map.set("n", n); return map; }
function descriptor(o) { return Object.getOwnPropertyDescriptor(o, "n"); }
function either(c, n) { return c ? table(n) : descriptor({ n }); }
const first = either(true, 1), second = either(false, 2), alone = table(3);
console.log(alone.get("n"), alone.size, alone instanceof Map, first instanceof Map, second instanceof Map, second.value, second.writable, first.get("n"));
