// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
// Under: --aot-testing=FailGuesses: every guess fails
const proto = {
  get body() { return this._body; },
  set body(value) { this._body = value; },
  get twice() { return this.body * 2; },
};
globalThis.madeUpProto = proto;
function App() { this.response = Object.create(proto); }
App.prototype.create = function (n) { const response = Object.create(this.response); response.body = n; return response; };
const app = new App();
let sum = 0;
for (let i = 0; i < process.argv.length + 2; i++) sum += app.create(i).twice;
console.log(sum - (process.argv.length + 2) * (process.argv.length + 1), app.response.body, proto.body);
