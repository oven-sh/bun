function target(a, b, c) { return arguments.length + "/" + a + "/" + b + "/" + c; }
const all = { target, proxy: new Proxy(target, {}) };
const names = JSON.parse('["target","proxy"]');
const byReflect = (fn, a, b) => Reflect.apply(fn, undefined, [a, b]);
const withHole = (fn, a) => fn.apply(undefined, [a, , a]);
function run(turn) { let text = ""; for (let i = 0; i < 2; i++) text += ":" + byReflect(all[names[i]], turn, i) + " " + withHole(all[names[i]], turn); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
