// STATISTIC: WasmFunctionsCompiled = 1
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
// A module whose bytes a list spells is compiled into the executable. A list that only begins like one, or whose length is cut at run time, is a list.
const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,6,1,96,1,127,1,127,2,7,1,1,109,1,102,0,0,3,2,1,0,7,5,1,1,114,0,1,10,29,1,27,1,1,127,3,64,32,1,32,0,16,0,106,33,1,32,0,65,1,107,34,0,13,0,11,32,1,11]);
let n = 0;
const { exports } = new WebAssembly.Instance(new WebAssembly.Module(bytes), { m: { f: x => (x + n) | 0 } });
console.log(exports.r(1000), exports.r(1));
const other = [0, 97, 115, 109, 1, 0, 0, 0, 300, -1, 0.5];
console.log(new Uint8Array(other).join(), other.length);
try {
  new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 99, 1, 0]));
} catch (error) {
  console.log(error instanceof WebAssembly.CompileError);
}
console.log(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])) instanceof WebAssembly.Module);
n = 1;
console.log(exports.r(10));
