// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
const proto = { get body() { return this._body; }, set body(value) { this._body = value; } };
globalThis.madeUpProto = proto;
const linked = { _body: "own", n: process.argv.length };
Object.setPrototypeOf(linked, proto);
const literalBelow = { __proto__: proto, _body: "written" };
linked.body = linked.body + "!";
console.log(linked.body, literalBelow.body, Object.keys(linked).join());
