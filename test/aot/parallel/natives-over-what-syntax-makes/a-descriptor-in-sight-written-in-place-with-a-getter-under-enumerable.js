// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
let asked = "";
const crate = Object.defineProperty({}, "weight", { value: 5, get enumerable() { asked += "enumerable "; return true; } });
console.log(crate.weight, Object.keys(crate).length, asked);
