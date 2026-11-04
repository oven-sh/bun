class Env { get env() { return new Functions(); } }
class Functions { answer() { return 42; } }
const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,2,14,1,3,101,110,118,6,97,110,115,119,101,114,0,0,7,7,1,3,114,117,110,0,0]);
console.log(new WebAssembly.Instance(new WebAssembly.Module(bytes), new Env()).exports.run());
