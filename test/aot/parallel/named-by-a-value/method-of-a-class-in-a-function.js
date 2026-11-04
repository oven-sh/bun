const part = globalThis.never ? "x" : "a";
function make() { return class { get area() { return 7; } side() { return 3; } }; }
const Made = make(); console.log(JSON.stringify(new Made(), ["area"]), Reflect.get(new Made(), "si" + (globalThis.never ? "" : "de"))());
