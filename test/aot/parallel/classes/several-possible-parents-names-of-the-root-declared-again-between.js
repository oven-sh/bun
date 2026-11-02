class Root {
  #secret = "root secret";
  shared = "root shared";
  plain;
  constructor(plain) {
    this.plain = plain;
  }
  get secret() {
    return this.#secret;
  }
  describe() {
    return "Root.describe " + this.shared + " " + this.plain;
  }
  get kind() {
    return "root kind";
  }
  static has(object) {
    return #secret in object;
  }
}
function SharedAgain(Base) {
  return class extends Base {
    shared = "shared again";
    own = "own of SharedAgain";
  };
}
function DescribesAgain(Base) {
  return class extends Base {
    describe() {
      return "DescribesAgain.describe > " + super.describe();
    }
  };
}
function KindAgain(Base) {
  return class extends Base {
    #secret = "secret of KindAgain";
    get kind() {
      return "kind again, " + this.#secret;
    }
  };
}
function PlainLater(Base) {
  return class extends Base {
    constructor(plain) {
      super(plain);
      this.plain = plain + ", stored later";
    }
  };
}
const mixins = [SharedAgain, DescribesAgain, KindAgain, PlainLater];
const classes = [];
for (let bits = 0; bits < 16; bits++) {
  let base = Root;
  for (let i = 0; i < mixins.length; i++) if (bits & (1 << i)) base = mixins[i](base);
  classes.push(class extends base {
    number() {
      return bits;
    }
  });
}
for (let round = 0; round < 3; round++) {
  for (const made of classes.map(each => new each("plain"))) {
    console.log(made.number(), made.secret, "|", made.shared, "|", made.plain, "|", made.own, "|", made.describe(), "|", made.kind, "|", Object.keys(made).join(","), Root.has(made));
  }
}
