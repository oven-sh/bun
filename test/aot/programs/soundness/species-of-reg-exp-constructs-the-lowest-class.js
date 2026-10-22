const log = [];
class A extends RegExp {
  constructor(pattern, flags) { super(pattern, flags); this.kind = this.describe(); log.push(new.target.name + " " + flags); }
  describe() { return "A"; }
}
class B extends A {
  extra = "x";
  describe() { return "B " + this.extra; }
  exec(text) { const r = super.exec(text); log.push("exec " + this.kind + " " + this.extra); return r; }
}
const b = new B("-", "g");
console.log("a-b-c".split(b).join("|"));
console.log([..."a-b".matchAll(b)].length);
console.log("a-b".replace(b, "+"), b.test("-"), b.kind, b.extra);
console.log(log.join(","));
