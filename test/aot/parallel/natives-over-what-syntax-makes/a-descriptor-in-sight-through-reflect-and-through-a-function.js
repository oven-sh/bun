// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
let asked = "";
const descriptor = { value: 5, get enumerable() { asked += "enumerable "; return true; } };
function lay(on, by) { return Object.defineProperty(on, "weight", by); }
const first = {};
console.log(Reflect.defineProperty(first, "weight", descriptor), Object.keys(first).length, Object.keys(lay({}, descriptor)).length, asked);
