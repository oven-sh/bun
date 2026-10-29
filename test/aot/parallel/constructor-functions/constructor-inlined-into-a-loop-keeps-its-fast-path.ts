// A constructor function that is found at run time and keeps its state under symbols, as a web framework's reply does. turn() and Reply() are both inlined into the loop of bench().
// STATISTIC: StretchesNotClonable = 0
const symbols = { kHeaders: Symbol("reply.headers"), kSent: Symbol("reply.sent"), kIsError: Symbol("reply.isError"), kStatus: Symbol("reply.status") };
const { kHeaders, kSent, kIsError, kStatus } = symbols;
function Reply(this: any, raw: unknown, id: number) {
  this.raw = raw;
  this[kIsError] = false;
  this[kSent] = false;
  this.id = id;
  this[kHeaders] = 0;
  this[kStatus] = 200;
}
Reply.prototype.header = function (this: any, size: number) {
  this[kHeaders] += size;
  return this;
};
Reply.prototype.send = function (this: any): number {
  if (this[kSent] || this[kIsError]) return 0;
  this[kSent] = true;
  return this[kHeaders] + this[kStatus] + this.id;
};
const context = new Function("context", "return context" + String(Date.now()).slice(99))({ Reply });
const raw = { ended: false };
function turn(i: number): number {
  const reply = new context.Reply(raw, i & 7);
  return reply.header(1).header(2).send();
}
function bench(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + turn(i)) | 0;
  return sum;
}
let answer = 0;
for (let round = 0; round < 50; round++) answer = (answer + bench(2000)) & 0xffffff;
console.log(answer);
