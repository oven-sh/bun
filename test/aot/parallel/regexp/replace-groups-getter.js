// `$<n>` in a replacement text reads `n` off the groups that exec() answered, through their prototypes.
class Groups {
  get n() {
    return "named";
  }
}
const made = Object.create({
  get n() {
    return "made";
  },
});
const pattern = groups => ({
  flags: "",
  turns: 0,
  exec() {
    if (this.turns++) return null;
    const match = ["a"];
    match.index = 0;
    match.groups = groups;
    return match;
  },
});
class Pattern {
  flags = "";
  turns = 0;
  exec() {
    if (this.turns++) return null;
    const match = ["a"];
    match.index = 0;
    match.groups = new Groups();
    return match;
  }
}
const replace = RegExp.prototype[Symbol.replace];
console.log("" + replace.call(pattern(new Groups()), "a", "[$<n>]"));
console.log("" + replace.call(pattern(made), "a", "[$<n>]"));
console.log("" + replace.call(new Pattern(), "a", "[$<n>]"));
