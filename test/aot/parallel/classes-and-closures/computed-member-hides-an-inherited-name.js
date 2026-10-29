const unseen = new Function("x", "return x");
function Base() {
  this.a = 1;
}
Base.prototype.on = function () {
  return "base on";
};
Base.prototype.emit = function () {
  return "base emit";
};
Base.prototype.late = function () {
  return "base late";
};
const key = Symbol("key");
const hidden = unseen("on");
class Below extends Base {
  [key]() {
    return "key";
  }
  plain() {
    return "plain";
  }
  [hidden]() {
    return "own on";
  }
  all() {
    return [this[key](), this.plain(), this.on(), this.emit(), this.late()].join();
  }
}
class Sibling extends Base {
  all() {
    return [this.on(), this.emit(), this.late()].join();
  }
}
unseen(Below);
unseen(Base);
function read(object) {
  return object.all();
}
const lines = [];
for (let round = 0; round < 300; round++) {
  const line = read(new Below()) + " | " + read(new Sibling());
  if (lines[lines.length - 1] !== line) lines.push(round + ": " + line), lines.push(line);
  if (round === 100) Base.prototype.emit = () => "changed emit";
  if (round === 150) Below.prototype.late = () => "own late";
  if (round === 200) delete Below.prototype.on;
  if (round === 250) Object.setPrototypeOf(Below.prototype, { on: () => "other on", emit: () => "other emit", late: () => "other late" });
}
console.log(lines.filter((line, index) => index % 2 === 0).join("\n"));
