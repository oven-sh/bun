// What a module exports, a static field and a property of the global object hold their objects as long as the module is there.
// A variable that nothing reads holds nothing behind the await, compiled or not: whether its object is still there hangs on what the
// collector finds on the stack, so that is not printed.
async function collect() { for (let i = 0; i < 4; i++) { await new Promise(done => setTimeout(done, 1)); Bun.gc(true); } }
function pair() { const o = { big: [1, 2, 3] }; return [o, new WeakRef(o)]; }
const [keptConst, weakConst] = pair();
let [keptLet, weakLet] = pair();
var [keptVar, weakVar] = pair();
export const [keptExport, weakExport] = pair();
class Registry { static kept; }
const weakStatic = (() => { const [o, w] = pair(); Registry.kept = o; return w; })();
const weakGlobal = (() => { const [o, w] = pair(); globalThis.keptGlobal = o; return w; })();
await collect();
console.log([weakConst, weakLet, weakVar].map(w => typeof w.deref).join());
console.log([weakExport, weakStatic, weakGlobal].map(w => w.deref() !== undefined).join());
