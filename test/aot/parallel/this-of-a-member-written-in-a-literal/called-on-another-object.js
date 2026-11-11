// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
const proto = { describe() { return typeof this + ":" + (this && this.tag); }, get tagged() { return this.tag + "!"; } };
globalThis.madeUpProto = proto;
const below = Object.create(proto);
below.tag = "below";
const other = { tag: "other", n: process.argv.length };
const getter = Object.getOwnPropertyDescriptor(proto, "tagged").get;
console.log(below.describe(), proto.describe.call(other), proto.describe.call(5), proto.describe.call(undefined), getter.call(other), below.tagged);
