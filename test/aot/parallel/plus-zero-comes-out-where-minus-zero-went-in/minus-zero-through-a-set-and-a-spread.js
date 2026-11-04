// -0 goes into a Set, which keeps +0; what comes out by a spread, a loop, Array.from, values() or forEach is +0. (health, 11-04 06:00: link-operators' reads-by-key-give-what-link-proves-1 proved -0 of the element read by key.)
const show = (label, x) => console.log(label, 1 / x, x + 1, x === 0, Object.is(x, 0), Object.is(x, -0), String(x), typeof x);
const x = [...new Set([-0])][0];
show("spread, by key", x);
function first(list) { return list[0]; }
show("spread, through a function", first([...new Set([-0])]));
const kept = new Set([-0, 1.5]);
show("a set of two", [...kept][0]);
show("Array.from", Array.from(new Set([-0]))[0]);
for (const one of new Set([-0])) show("for of", one);
new Set([-0]).forEach(one => show("forEach", one));
show("values().next()", new Set([-0]).values().next().value);
const added = new Set(); added.add(-0);
show("added", [...added][0]);
const map = new Map([[-0, -0]]);
show("a key of a Map", [...map.keys()][0]);
show("a value of a Map stays -0", [...map.values()][0]);
show("an entry's key", [...map][0][0]);
show("a list keeps -0", [...[-0]][0]);
let sum = 0;
for (let i = 0; i < 1000; i++) sum += 1 / [...new Set([-0, i])][0];
console.log("in a loop", sum);
