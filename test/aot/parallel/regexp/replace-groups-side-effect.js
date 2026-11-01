// What a getter of the groups stores is seen behind the call of Symbol.replace.
class Base {
  get n() {
    this.reads = 1;
    return "named";
  }
}
class Groups extends Base {
  reads = 0;
}
class Other extends Base {
  reads = 0;
}
console.log("" + new Other().n);
function run() {
  const groups = new Groups();
  const pattern = {
    flags: "",
    turns: 0,
    exec() {
      if (this.turns++) return null;
      const match = ["a"];
      match.index = 0;
      match.groups = groups;
      return match;
    },
  };
  const text = RegExp.prototype[Symbol.replace].call(pattern, "a", "[$<n>]");
  return groups.reads + text;
}
console.log("" + run());
