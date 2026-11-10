function Reply(raw) { this.raw = raw; }
Reply.list = [];
Reply.count = { hits: 0 };
Reply.describe = function (what) { this.count.hits++; return typeof what + ":" + this.list.length; };
function buildReply(R) { function _Reply(raw) { this.raw = raw; } Object.setPrototypeOf(_Reply.prototype, R.prototype); Object.setPrototypeOf(_Reply, R); return _Reply; }
const Second = buildReply(Reply);
function add(what) { Second.list.push(what); }
function first() { const one = Reply.list[0]; return typeof one === "string" ? one.toUpperCase() : one; }
function sum() { let total = 0; for (let i = 0; i < Reply.list.length; i++) total += Reply.list[i].length; return total; }
add("text"); add("more");
console.log(first(), Reply.list.length, sum(), Second.describe(7), Second.describe("x"), Reply.count.hits, new Second(1).raw);
