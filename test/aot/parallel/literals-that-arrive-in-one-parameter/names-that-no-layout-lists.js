const base = { inherited: "from the base" };
const mark = Symbol("mark");
function show(x) { return JSON.stringify(x) + " " + Object.keys(x).join() + " " + String(x.inherited) + " " + String(x[0]) + " " + String(x[mark]); }
function pass(x) { return show(x); }
console.log(pass({ 0: 1 }));
console.log(pass({ 0: 2 }));
console.log(pass({ 1: 2 }));
console.log(pass({ 0: 1, a: 1 }));
console.log(pass({ 0: 2, a: 2 }));
console.log(pass({ __proto__: base }));
console.log(pass({ __proto__: null, a: 1 }.a === 1 ? { __proto__: base, a: 1 } : {}));
console.log(pass({ __proto__: base, a: 2 }));
console.log(pass({ ["__proto__"]: 1 }));
console.log(pass({ [mark]: 1 }));
console.log(pass({ [mark]: 2 }));
console.log(pass({ [mark]: 3, a: 3 }));
console.log(pass({ "two words": 1 }));
console.log(pass({ "two words": 2 }));
console.log(pass({ NaN: 1 }));
console.log(pass({ NaN: 2 }));
console.log(pass({ Infinity: 1 }));
console.log(pass({ Infinity: 2 }));
console.log(pass({ "-0": 1 }));
console.log(pass({ "-0": 2 }));
console.log(pass({ "": 1 }));
console.log(pass({ "": 2 }));
function grow(x, name) { x[name] = "later"; return x; }
console.log(pass(grow({ NaN: 3 }, "a")));
console.log(pass(grow({ NaN: 4 }, "b")));
console.log(pass(grow({ 0: 3 }, "a")));
console.log(pass(grow({ 0: 4 }, "b")));
