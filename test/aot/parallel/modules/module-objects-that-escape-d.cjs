// A file calls what it hands out where it is the one that was started.
class Box {
  constructor(value) {
    this.value = value;
  }
  get(name) {
    return name + this.value;
  }
}
module.exports = main;
function main(holder) {
  const box = holder || new Box(7);
  console.log(box.get("v"));
}
if (require.main === module) {
  module.exports(new Map([["v", "held"]]));
  module.exports();
}
