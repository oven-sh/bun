// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
let asked = "";
const descriptor = { value: 5, writable: false, get enumerable() { asked += "enumerable "; return true; }, configurable: false };
const crate = Object.defineProperty({}, "weight", descriptor);
console.log(crate.weight, Object.keys(crate).length, asked);
