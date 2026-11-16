// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
let asked = "";
const descriptor = { value: 5, get writable() { asked += "writable "; return true; }, enumerable: true, get configurable() { asked += "configurable "; return false; } };
const crate = Object.defineProperty({}, "weight", descriptor);
crate.weight = 6;
console.log(crate.weight, Object.keys(crate).length, asked);
