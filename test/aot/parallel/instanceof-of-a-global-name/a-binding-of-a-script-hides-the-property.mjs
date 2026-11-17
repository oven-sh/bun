import vm from "node:vm";
function Early() {}
globalThis.Crate = Early;
function isOne(x) { try { return x instanceof Crate; } catch (error) { return error.constructor.name; } }
globalThis.kept = isOne;
const one = new Early();
console.log(globalThis.kept(one), globalThis.kept({}));
let made;
try { made = vm.runInThisContext("let Crate = class {}; new Crate()"); } catch (error) { console.log("no script:", error.constructor.name); }
console.log(globalThis.kept(one), globalThis.kept(made), globalThis.kept({}));
try { vm.runInThisContext("throw 1; let Shelf = class {};"); } catch (error) { console.log("threw", String(error)); }
function isShelf(x) { try { return x instanceof Shelf; } catch (error) { return error.constructor.name; } }
globalThis.other = isShelf;
console.log(globalThis.other(one), globalThis.other(one));
