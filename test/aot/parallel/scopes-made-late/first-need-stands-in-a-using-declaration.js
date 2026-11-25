const log = [];
function f(quick) { if (quick) return "quick"; using a = { [Symbol.dispose]() { log.push("a" + n); } }; let n = 1; const bump = () => ++n; bump(); return "n" + n; }
function g(quick) { if (quick) return "quick"; let n = 0; using r = { get: () => ++n, [Symbol.dispose]() { log.push("r" + n); } }; r.get(); return "n" + n; }
async function h(quick) { if (quick) return "quick"; await using r = { async [Symbol.asyncDispose]() { log.push("h" + n); } }; let n = 5; const read = () => n; return "n" + read(); }
console.log(f(true), f(false), g(true), g(false)); h(true).then(console.log); h(false).then(v => console.log(v, log.join()));
