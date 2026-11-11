// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
const proto = { total() { return this.a + this.b; } };
globalThis.madeUpProto = proto;
const borrower = { a: process.argv.length, b: 1, total: proto.total };
class Holder { constructor() { this.a = 2; this.b = 3; } }
Holder.prototype.total = proto.total;
const below = Object.assign(Object.create(proto), { a: 10, b: 20 });
console.log(borrower.total() - process.argv.length, new Holder().total(), below.total());
