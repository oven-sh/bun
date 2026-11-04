const o = { a: 1 };
function act() { Object.defineProperty(o, "hiddenName", { value: 1, enumerable: true }); }
act();
o.b = 2;
console.log(Object.keys(o).join(), JSON.stringify(o));
