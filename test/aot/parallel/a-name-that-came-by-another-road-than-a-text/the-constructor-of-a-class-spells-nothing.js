// The constructor of a class is named after the class: the word in front of its parameters spells no name.
// STATISTIC: FunctionsLowered <= 60
class Shelf {
  constructor() {
    this.held = 1;
  }
}
const shelf = new Shelf();
const pick = (holder, key) => holder[key];
