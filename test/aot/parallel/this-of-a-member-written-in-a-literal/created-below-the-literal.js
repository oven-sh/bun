// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
const proto = {
  get body() { return this._body; },
  set body(value) { this._body = value; this.count = (this.count | 0) + 1; },
  describe(tag) { return tag + ":" + this._body + ":" + this.count; },
};
globalThis.madeUpProto = proto;
function make(n) { const made = Object.create(proto); made.body = n; made.body = n + 1; return made; }
const made = make(process.argv.length);
console.log(made.body - process.argv.length, made.describe("t").replace(String(process.argv.length + 1), "n"), Object.keys(made).join());
