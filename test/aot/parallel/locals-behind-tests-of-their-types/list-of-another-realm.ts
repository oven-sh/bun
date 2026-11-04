import vm from "node:vm";
function probe(value: string | number[]): number { let total = 0; for (let turn = 0; turn < 3; turn++) { if (Array.isArray(value)) total += value.length; else total -= 1; } return total; }
(globalThis as any).probe = probe;
const other = vm.runInNewContext("[1, 2, 3, 4]");
console.log(probe(other), other instanceof Array, probe(vm.runInNewContext("new Proxy([1], {})")), probe(vm.runInNewContext("({ length: 2 })")));
