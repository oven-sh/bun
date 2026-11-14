// Classes made by functions that extend their argument
const Named = Parent => class extends Parent {
  constructor(...all) {
    super(...all);
    this.name = "n" + this.id;
  }
};
const Counted = Parent => class extends Parent {
  static count = 0;
  constructor(...all) {
    super(...all);
    this.order = ++new.target.count;
  }
};
class Item {
  constructor(id) {
    this.id = id;
  }
}
class Both extends Counted(Named(Item)) {}
class Other extends Named(Item) {}
function make(id) {
  return JSON.stringify(new Both(id)) + JSON.stringify(new Other(id + 1)) + Both.count;
}
console.log(make(1));
console.log(make(20));
console.log(make(-1));
