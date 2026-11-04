// A private name takes no place among the keys, wherever it is declared.
class First {
  #hidden = 1;
  shown = 2;
  get hidden() {
    return this.#hidden;
  }
}
class Between {
  before = 1;
  #hidden = 2;
  after = 3;
  get hidden() {
    return this.#hidden;
  }
}
class Below extends Between {
  #own = 4;
  last = 5;
  get own() {
    return this.#own;
  }
}
console.log(Object.keys(new First()).join(), Object.keys(new Between()).join(), Object.keys(new Below()).join());
console.log(JSON.stringify({ ...new Between() }), new First().hidden + new Between().hidden + new Below().own);
