// What a proxy answers under a name is for its handler to say. Compiled code asks the run time once for such a read: it does not first look the name up in the objects themselves.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lookups = () => count("operationAOTGetGeneric");
const reads = () => count("operationAOTGetById") + count("operationAOTGetByIdAndCache") + count("operationAOTGetWithProxyTrap");
const readWanted = object => object.wanted;
const readOther = object => object.other;
let calls = 0;
const trapped = new Proxy({}, { get(target, key) { calls++; return key; } });
const passedOn = new Proxy({ wanted: "of the target" }, {});
const mixed = [{ wanted: "plain" }, trapped, Object.create({ wanted: "inherited" }), passedOn, {}, "text"];
for (let round = 0; round < 3; round++) console.log(mixed.map(readWanted).join(" | "), "|", mixed.map(readOther).join(" | "));
const before = lookups();
const readsBefore = reads();
let text = 0;
for (let i = 0; i < 2000; i++) text += readWanted(trapped).length + readOther(trapped).length + readWanted(passedOn).length + String(readOther(passedOn)).length;
console.log(text, calls, "no name is looked up in the objects for 8000 reads through proxies:", lookups() - before === 0, "and the run time is asked at most once a read:", reads() - readsBefore <= 8000);
