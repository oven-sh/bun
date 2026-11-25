let seen = "the file's";
class Holder {
  field = eval("seen + ' by a field'");
  method(own) { return eval("seen = own; this.field"); }
  static *steps(first) { yield eval("first + 1"); yield eval("seen"); }
  static async later(value) { await null; return eval("value + ' ' + seen"); }
}
const holder = new Holder();
console.log(holder.field, "|", holder.method("stored by a method"), "|", seen);
console.log([...Holder.steps(1)].join(" "));
Holder.later("later:").then(console.log);
