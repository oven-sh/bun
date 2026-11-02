// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
class A { p = process; m() { return this.p.getBuiltinModule("node:dgram"); } }
let answer;
try { answer = typeof (new A().m())?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
