import vm from "node:vm";
class P { #x = 1; static is(o) { return #x in o; } }
const other = vm.runInNewContext("({ a: 1 })"), proxy = new Proxy(new P(), {});
const out = []; for (let i = 0; i < 3; i++) out.push(P.is(other), P.is(proxy), P.is(new P()));
console.log(out.join(" "));
