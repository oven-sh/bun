// The programs here ask the `jsc` shell how often compiled code called an operation of the run time, and take 0 for each count where the function is missing. They ask in several ways.
// Each way reaches the function of the shell: each is told a count above 0 for an operation that this program has called.
const name = "operationAOTGetGlobalBinding";
const byTypeof = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const byTypeofOfMember = typeof globalThis.aotOperationCount === "function" ? globalThis.aotOperationCount : () => 0;
const byNullish = globalThis.aotOperationCount ?? (() => 0);
const byOr = globalThis.aotOperationCount || (() => 0);
const byIn = "aotOperationCount" in globalThis ? globalThis.aotOperationCount : () => 0;
console.log("typeof", byTypeof(name) > 0);
console.log("typeof of a member", byTypeofOfMember(name) > 0);
console.log("??", byNullish(name) > 0);
console.log("||", byOr(name) > 0);
console.log("in", byIn(name) > 0);
console.log("?.", globalThis.aotOperationCount?.(name) > 0);
console.log("a call", aotOperationCount(name) > 0);
console.log("the whole list", globalThis.aotRuntimeCounters().split("\n").filter(line => line.endsWith("\toperation:" + name)).length);
console.log("the whole list behind typeof", typeof aotRuntimeCounters === "function" ? /^[1-9][0-9]*\toperation:operationAOTGetGlobalBinding$/m.test(aotRuntimeCounters()) : false);
