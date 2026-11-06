class Root {
  first = "root first";
  #hidden = "hidden";
  second;
  constructor(second) {
    this.second = second;
  }
  get hidden() {
    return this.#hidden;
  }
}
function WithField(Base) {
  return class extends Base {
    between = "between";
  };
}
function WithTwoFields(Base) {
  return class extends Base {
    early = "early";
    #own = "own of the class between";
    constructor(second) {
      super(second);
      this.stored = "stored by the class between";
    }
    get own() {
      return this.#own;
    }
  };
}
const classes = [];
for (let bits = 0; bits < 4; bits++) {
  let base = Root;
  if (bits & 1) base = WithField(base);
  if (bits & 2) base = WithTwoFields(base);
  classes.push(class extends base {
    leaf = "leaf " + bits;
    constructor(second) {
      super(second);
      this.last = "last";
    }
  });
}
for (let round = 0; round < 3; round++) {
  for (const each of classes) {
    const made = new each("second");
    const walked = [];
    for (const key in made) walked.push(key);
    console.log(Object.keys(made).join(), "|", walked.join(), "|", JSON.stringify(made), "|", Object.entries(made).length, made.hidden, made.own);
    delete made.first;
    made.first = "again";
    made.added = 1;
    console.log(Object.keys(made).join(), "|", Reflect.ownKeys(made).join(), "|", JSON.stringify({ ...made }));
  }
}
