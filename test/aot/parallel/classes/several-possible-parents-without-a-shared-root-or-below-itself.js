class Left {
  side = "left";
  #mark = "left mark";
  get mark() {
    return this.#mark;
  }
}
class Right {
  side = "right";
  #mark = "right mark";
  get mark() {
    return this.#mark;
  }
}
const unrelated = [];
for (let i = 0; i < 4; i++) unrelated.push(class extends (i & 1 ? Left : Right) {});
for (const each of unrelated) {
  const made = new each();
  console.log(made.side, made.mark, made instanceof Left, made instanceof Right);
}
class Start {
  depth = 0;
  #levels = ["start"];
  add(level) {
    this.#levels.push(level);
    return this.#levels.join(">");
  }
}
let tower = Start;
for (let i = 0; i < 4; i++) {
  tower = class extends tower {
    level = i;
    constructor() {
      super();
      this.depth++;
      this.add("level " + i);
    }
  };
  const made = new tower();
  console.log(made.depth, made.level, made.add("end"), Object.keys(made).join(","));
}
const orNothing = [];
for (let i = 0; i < 3; i++) orNothing.push(class extends (i === 1 ? null : Start) {
  constructor() {
    if (i === 1) return Object.create(new.target.prototype);
    super();
  }
});
for (const each of orNothing) {
  const made = new each();
  console.log(made.depth, typeof made.add, made instanceof Start);
}
const orBuiltIn = [];
for (let i = 0; i < 3; i++) orBuiltIn.push(class extends (i === 1 ? Array : Start) {});
for (const each of orBuiltIn) {
  const made = new each();
  console.log(made.depth, made.length, Array.isArray(made));
}
