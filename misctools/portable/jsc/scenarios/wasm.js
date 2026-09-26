// Scenario 5: WebAssembly. A module with a memory of one page and two functions:
//   sum(n)    adds 0 .. n-1 in a loop
//   load(a)   i32.load at address a
// load() outside of the memory has to trap, and JavaScript has to catch the trap as
// WebAssembly.RuntimeError: before the functions are hot, and after (other tiers).
var bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,6,1,96,1,127,1,127,3,3,2,0,0,5,3,1,0,1,7,20,3,3,109,101,109,2,0,3,115,117,109,0,0,4,108,111,97,100,0,1,10,45,2,35,1,2,127,2,64,3,64,32,1,32,0,79,13,1,32,2,32,1,106,33,2,32,1,65,1,106,33,1,12,0,11,11,32,2,11,7,0,32,0,40,2,0,11]);
var instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
var e = instance.exports;
function trap(address) {
    try {
        e.load(address);
        return "no trap";
    } catch (error) {
        return (error instanceof WebAssembly.RuntimeError) + ":" + error.constructor.name + ":" + error.message.replace(/ \(evaluating.*/, "");
    }
}
print("wasm sum " + e.sum(1000));
new Uint32Array(e.mem.buffer)[4] = 0xdecaf;
print("wasm load " + e.load(16).toString(16));
print("wasm trap cold " + trap(65536 * 4));
var s = 0;
for (var n = 0; n < 30000; n++)
    s = (s + e.sum(1000) + e.load(16)) | 0;
print("wasm hot " + (s >>> 0).toString(16));
var traps = 0;
for (var n = 0; n < 200; n++)
    if (trap(65536 + n * 4096) == "true:RuntimeError:Out of bounds memory access")
        traps++;
print("wasm traps hot " + traps + " of 200");
print("wasm trap last page " + trap(65533) + " ok " + e.load(65532));
