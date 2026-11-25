const o = Object.freeze({ a: 1 });
function act() { try { Object.defineProperty(o, "hiddenName", { value: 1 }); return "defined"; } catch (e) { return e.constructor.name; } }
console.log(act(), Object.keys(o).join());
