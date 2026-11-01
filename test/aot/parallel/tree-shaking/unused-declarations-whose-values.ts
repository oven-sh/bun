// Nothing reads any of these declarations, and each of them does something when it is evaluated. All of it happens, in this order.
const log: string[] = [];
const sideEffect = log.push("call");
const getter = { get value() { log.push("getter"); return 1; } }.value;
const spread = { ...{ get x() { log.push("spread"); return 1; } } };
const templated = `${{ toString() { log.push("toString"); return ""; } }}`;
class WithStatic { static made = log.push("static field"); static { log.push("static block"); } }
class WithKey { [(log.push("computed key"), "k")]() {} }
const made = new (class { constructor() { log.push("constructor"); } })();
const tagged = ((strings: TemplateStringsArray) => log.push("tag"))`x`;
const awaited = await { then(resolve: (value: number) => void) { log.push("then"); resolve(1); } };
const inOperator = "a" in new Proxy({}, { has() { log.push("has"); return true; } });
const unary = +{ valueOf() { log.push("valueOf"); return 1; } };
console.log(log.join());
