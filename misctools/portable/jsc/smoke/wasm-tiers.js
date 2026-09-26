// Which WebAssembly tiers run? probe() loops n times, then returns callerIsBBQOrOMGCompiled() | ($vm.omgTrue() << 1),
// both asked from inside the wasm frame. 0 = interpreter (IPInt), 1 = BBQ, 3 = OMG.
var bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,10,2,96,0,1,127,96,1,127,1,127,2,21,2,3,101,110,118,3,98,98,113,0,0,3,101,110,118,3,111,109,103,0,0,3,2,1,1,7,9,1,5,112,114,111,98,101,0,2,10,43,1,41,1,2,127,2,64,3,64,32,1,32,0,79,13,1,32,2,32,1,106,33,2,32,1,65,1,106,33,1,12,0,11,11,16,0,16,1,65,1,116,114,11]);
var instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { bbq: callerIsBBQOrOMGCompiled, omg: $vm.omgTrue } });
var seen = {};
for (var i = 0; i < 300000; i++) {
    var v = instance.exports.probe(50);
    seen[v] = (seen[v] || 0) + 1;
}
print("wasm tiers seen (0 interpreter, 1 BBQ, 3 OMG): " + JSON.stringify(seen));
print("WASMTIERS interpreter=" + !!seen[0] + " bbq=" + !!seen[1] + " omg=" + !!seen[3]);

// Timers of the shell's run loop (with USE_BUN_EVENT_LOOP the WTFTimer__* functions are weak and undefined in the shell)
var fired = [];
setTimeout(function () { fired.push("b"); }, 20);
setTimeout(function () { fired.push("a"); print("TIMERS fired in order: " + fired.join(",")); }, 1);
