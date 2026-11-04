const f = globalThis.nothing || (() => y);
let before;
try { before = Reflect.apply(f, undefined, []); } catch (error) { before = error.name; }
let y = 2;
console.log(before, Reflect.apply(f, undefined, []));
