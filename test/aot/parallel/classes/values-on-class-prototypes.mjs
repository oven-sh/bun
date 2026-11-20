// Values on the prototypes of classes answer for objects that have no field of their own under the name: in heirs, beside methods, replaced, deleted, and hidden by accessors.
const notes = [];
const note = value => void notes.push(typeof value + " " + String(value));
class Lost {
  n = 1;
}
Lost.prototype.gone = 0;
class Above {}
Above.prototype.tag = "above";
Above.prototype.weight = 1.5;
class Heir extends Above {
  own = 2;
}
class Lower extends Heir {
  constructor(given) {
    super();
    if (given & 1) this.weight = given;
  }
}
class Replaced {}
Replaced.prototype.flag = true;
class Hidden {}
Hidden.prototype.level = 3;
class Late {
  touch() {
    return this.mark;
  }
}
function counts(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const lost = new Lost();
    lost.gone++;
    if (i & 1) lost.gone += lost.n;
    sum += lost.gone;
  }
  return sum;
}
function heirs(turns) {
  const list = [];
  for (let i = 0; i < turns; i++) {
    const lower = new Lower(i);
    note(lower.tag);
    note(lower.weight);
    lower.weight += 1;
    lower.tag += i;
    list.push(lower);
  }
  for (const one of list) note(one.tag + one.weight + Object.keys(one).join());
}
function replaced(turns) {
  for (let i = 0; i < turns; i++) {
    const one = new Replaced();
    if (i === 2) Replaced.prototype.flag = null;
    if (i === 4) delete Replaced.prototype.flag;
    if (i === 5) Replaced.prototype.flag = "again";
    note(one.flag);
    one.flag = i;
    note(one.flag);
  }
  Replaced.prototype.flag = true;
}
function hidden(turns) {
  for (let i = 0; i < turns; i++) {
    const one = new Hidden();
    if (i === 3)
      Object.defineProperty(Hidden.prototype, "level", {
        get() {
          return -1;
        },
        set(value) {
          notes.push("set " + value);
        },
        configurable: true,
      });
    note(one.level);
    one.level = i;
    note(one.level);
  }
  Object.defineProperty(Hidden.prototype, "level", { value: 3, writable: true, configurable: true });
}
function late(turns) {
  for (let i = 0; i < turns; i++) {
    const one = new Late();
    note(one.touch());
    if (i === 1) Late.prototype.mark = 5;
    note(one.mark);
    one.mark = i;
  }
}
for (let round = 0; round < 3; round++) {
  note(counts(10));
  heirs(4);
  replaced(7);
  hidden(5);
  late(3);
}
console.log(notes.join(" "));
