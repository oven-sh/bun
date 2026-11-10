// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
const proto = { plain: function () { return this && this.tag; }, arrow: () => typeof this, tag: "literal" };
globalThis.madeUpProto = proto;
const below = Object.create(proto);
below.tag = "below" + (process.argv.length > 99 ? "!" : "");
console.log(below.plain(), proto.plain(), below.arrow(), typeof new proto.plain());
