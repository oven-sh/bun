function isIn(thing) { return "mark" in thing; }
function isOwn(thing) { return Object.hasOwn(thing, "mark"); }
function both(label, thing) { let a = 0, b = 0; for (let turn = 0; turn < 300; turn++) { if (isIn(thing)) a++; if (isOwn(thing)) b++; } console.log(label, a, b); }

const crowded = { };
for (let index = 0; index < 300; index++) crowded["name" + index] = index;
both("three hundred names", crowded);
crowded.mark = 1;
both("and the name", crowded);
for (let index = 0; index < 150; index++) delete crowded["name" + index];
both("half of them deleted", crowded);
delete crowded.mark;
both("the name deleted", crowded);
crowded.mark = 2;
both("the name back", crowded);

let asked = 0;
const guarded = new Proxy({ }, { has(target, key) { asked++; return key === "mark" && asked % 2 === 0; }, getOwnPropertyDescriptor(target, key) { asked += 1000; return undefined; } });
both("a proxy", guarded);
console.log(asked);
const belowProxy = Object.create(guarded);
both("below a proxy", belowProxy);
console.log(asked);

const frozen = Object.freeze({ mark: 1 });
both("frozen", frozen);
const sealed = Object.seal({ other: 1 });
both("sealed", sealed);
const list = [1, 2, 3];
both("a list", list);
list.mark = 1;
both("a list with the name", list);
function named() { }
both("a function", named);
named.mark = 1;
both("a function with the name", named);
both("a bound function", named.bind(null));
both("a class", class { static mark = 1; });
both("an error", new Error("made up"));
both("the global object", globalThis);
globalThis.mark = 1;
both("the global object with the name", globalThis);
delete globalThis.mark;
both("the global object without it again", globalThis);
const kinds = [crowded, frozen, sealed, list, named, { mark: 1 }, { other: 2 }, Object.create({ mark: 1 }), Object.create(null), guarded];
let sum = 0;
for (let turn = 0; turn < 5000; turn++) { const thing = kinds[turn % kinds.length]; if (isIn(thing)) sum += 1; if (isOwn(thing)) sum += 7; }
console.log(sum);
