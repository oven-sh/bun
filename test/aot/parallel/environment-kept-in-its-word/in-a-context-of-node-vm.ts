// in a context of node vm
import vm from "node:vm";
console.log(vm.runInNewContext("typeof process"), vm.runInNewContext("p.env === e", { p: process, e: process.env }), vm.runInNewContext("p.env = { A: 1 }; p.env.A", { p: { env: process.env } }), typeof process.env.PATH);
