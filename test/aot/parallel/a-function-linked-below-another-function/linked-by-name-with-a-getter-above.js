const kHeaders = Symbol("headers"), kSent = Symbol("sent");
function Reply(res, request, log) { this.raw = res; this[kSent] = false; this[kHeaders] = null; this.request = request; this.log = log; }
Reply.props = [];
Reply.prototype.header = function (key, value) { if (this[kHeaders] === null) this[kHeaders] = { count: 0 }; this[kHeaders].count += value; return this; };
Reply.prototype.code = function (code) { this.raw.statusCode = code; return this; };
Reply.prototype.send = function (payload) { if (this[kSent]) return 0; this[kSent] = true; return this.raw.statusCode + this[kHeaders].count + payload; };
Object.defineProperty(Reply.prototype, "sent", { get() { return this[kSent]; } });
function _Reply(res, request, log) { this.raw = res; this[kSent] = false; this[kHeaders] = null; this.request = request; this.log = log; }
Object.setPrototypeOf(_Reply.prototype, Reply.prototype);
Object.setPrototypeOf(_Reply, Reply);
_Reply.parent = Reply;
_Reply.props = Reply.props.slice();
const Second = _Reply;
const count = 1000;
const res = { statusCode: 0 }, request = { id: 1 }, log = {};
let sum = 0;
for (let i = 0; i < count; i++) { const reply = new Second(res, request, log); sum += reply.code(200).header("a", i & 3).send(1) + (reply.sent ? 1 : 0); }
console.log(sum);
