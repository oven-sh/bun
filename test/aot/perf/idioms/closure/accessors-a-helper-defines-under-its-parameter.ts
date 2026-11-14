import { nextTurns } from "../host.ts";
// A helper object forwards names of one object to a member of it: each accessor is a closure over two texts that every call of the helper writes out.
function Forwarder(this: any, holder: any, member: string): any {
  if (!((this as object) instanceof Forwarder)) return new (Forwarder as any)(holder, member);
  this.holder = holder;
  this.member = member;
  this.getters = [];
  this.setters = [];
}
Forwarder.prototype.getter = function (name: string) {
  const holder = this.holder,
    member = this.member;
  this.getters.push(name);
  holder.__defineGetter__(name, function (this: any) {
    return this[member][name];
  });
  return this;
};
Forwarder.prototype.setter = function (name: string) {
  const holder = this.holder,
    member = this.member;
  this.setters.push(name);
  holder.__defineSetter__(name, function (this: any, value: any) {
    return (this[member][name] = value);
  });
  return this;
};
Forwarder.prototype.access = function (name: string) {
  return this.getter(name).setter(name);
};
const exchange: any = {
  describe() {
    return this.question.path + this.answer.code;
  },
};
(Forwarder as any)(exchange, "answer").access("code").access("size").getter("sent");
(Forwarder as any)(exchange, "question").access("path").getter("verb").getter("host");
function bench(n: number): number {
  let s = 0;
  const question = { path: "/", verb: "GET", host: "a" };
  for (let i = 0; i < n; i++) {
    const made = Object.create(exchange);
    made.question = question;
    made.answer = { code: 200, size: 0, sent: false };
    made.code = i & 255;
    made.size = i & 3;
    if (made.verb === "GET") s += made.code + made.size;
    if (made.path === "/" && !made.sent) s += 1;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
