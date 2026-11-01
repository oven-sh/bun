// A printer of native code reads the four dates of a Stats, and each lays itself on the object that it is read off, whoever made that object.
const { Stats, statSync } = require("node:fs");

const dates = ["atime", "mtime", "ctime", "birthtime"];
const ownDates = o => dates.filter(name => Object.hasOwn(o, name)).length;

class Heir extends Stats {
  constructor(ms) {
    super();
    this.atimeMs = ms;
    this.label = "heir";
  }
}

const made = {
  stat: () => statSync("."),
  bigint: () => statSync(".", { bigint: true }),
  constructed: () => new Stats(),
  heir: () => new Heir(1000),
  literal: () => ({ __proto__: Stats.prototype, atimeMs: 1000, mtimeMs: 2000, ctimeMs: 3000, birthtimeMs: 4000 }),
  created: () => Object.assign(Object.create(Stats.prototype), { atimeMs: 1000 }),
};

for (const [name, make] of Object.entries(made)) {
  const o = make();
  const before = ownDates(o);
  const text = Bun.inspect(o);
  const laid = Object.getOwnPropertyDescriptor(o, "atime");
  console.log(name, before, ownDates(o), typeof text, laid !== undefined && laid.value === o.atime);
}

// The date that the print laid stays, whatever becomes of the number under it.
const kept = made.literal();
Bun.inspect(kept);
kept.atimeMs = 999000;
console.log("kept", kept.atime.getTime());
