function Early() {}
function Late() {}
globalThis.Crate = Early;
function make(next, made) { globalThis.Crate = next; return made; }
function test(next, made) { return make(next, made) instanceof Crate; }
globalThis.kept = test;
console.log(globalThis.kept(Late, new Early()), globalThis.kept(Early, new Early()), globalThis.kept(Late, new Late()), globalThis.kept(Early, new Late()));
function missing(made) { try { return (console.log("left"), made) instanceof Nowhere; } catch (error) { return error.constructor.name; } }
globalThis.other = missing;
console.log(globalThis.other({}), globalThis.other(1));
