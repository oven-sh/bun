function describe(object) {
  return [object.size, Object.hasOwn(object, "size"), "size" in object, Object.keys(object).join(), JSON.stringify(object)].join(" ");
}

let taken = 0;
class Sized {
  constructor(size) {
    this.stored = 0;
    this.size = size;
    this.extra = 1;
  }
}
Object.defineProperty(Sized.prototype, "size", {
  set(value) {
    taken += value;
    this.stored = value;
  },
  get() {
    return this.stored * 2;
  },
});
function sumOf(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const made = new Sized(round & 7);
    sum += made.size + made.extra;
  }
  return sum;
}

let onlyStored = 0;
class NeverRead {
  constructor(size) {
    this.size = size;
    this.extra = 1;
  }
}
Object.defineProperty(NeverRead.prototype, "size", {
  set(value) {
    onlyStored += value;
  },
});
function storeOnly(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += new NeverRead(round & 7).extra;
  return sum;
}

let removed = 0;
class Removable {
  constructor(size) {
    this.size = size;
  }
}
Object.defineProperty(Removable.prototype, "size", {
  set(value) {
    removed += value;
  },
  get() {
    return -1;
  },
  configurable: true,
});
function makeRemovable(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += new Removable(round & 7).size;
  return sum;
}

let first = 0;
let second = 0;
class Replaced {
  constructor(size) {
    this.size = size;
  }
}
Object.defineProperty(Replaced.prototype, "size", {
  set(value) {
    first += value;
  },
  get() {
    return 1;
  },
  configurable: true,
});
function makeReplaced(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += new Replaced(round & 7).size;
  return sum;
}

let below = 0;
class Hidden {
  constructor(size) {
    this.size = size;
  }
}
Object.defineProperty(Hidden.prototype, "size", {
  set(value) {
    below += value;
  },
  get() {
    return "inherited";
  },
});
class WithField extends Hidden {
  size = "own";
}
function readAll(objects) {
  let text = "";
  for (let round = 0; round < 8; round++) {
    const object = objects[round & 3];
    text += object.size + ",";
    object.size = round;
    text += object.size + " ";
  }
  return text;
}

class ReadOnly {
  constructor(size) {
    this.extra = 1;
    this.size = size;
  }
}
Object.defineProperty(ReadOnly.prototype, "size", {
  get() {
    return 7;
  },
});
function makeReadOnly(rounds) {
  let failures = 0;
  let message = "";
  for (let round = 0; round < rounds; round++) {
    try {
      new ReadOnly(round);
    } catch (error) {
      failures++;
      message = error.constructor.name;
    }
  }
  return failures + " " + message;
}

let several = 0;
class Several {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
}
Object.defineProperties(Several.prototype, {
  width: {
    set(value) {
      several += value;
    },
    get() {
      return 3;
    },
  },
  height: {
    set(value) {
      several += value * 10;
    },
    get() {
      return 4;
    },
  },
});
function makeSeveral(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const made = new Several(round & 3, round & 1);
    sum += made.width * made.height;
  }
  return sum;
}

console.log(sumOf(1000), taken, describe(new Sized(1)));
console.log(storeOnly(1000), onlyStored, describe(new NeverRead(1)));
const early = new Removable(9);
console.log(makeRemovable(100), removed, describe(early));
delete Removable.prototype.size;
console.log(makeRemovable(100), removed, describe(early), describe(new Removable(4)));
early.size = 6;
console.log(describe(early));
console.log(makeReplaced(100), first, second);
Object.defineProperty(Replaced.prototype, "size", {
  set(value) {
    second += value;
  },
  get() {
    return 2;
  },
});
console.log(makeReplaced(100), first, second, describe(new Replaced(1)));
const mixed = [new Hidden(1), new WithField(2), new Hidden(3), new WithField(4)];
console.log(readAll(mixed), below, mixed.map(describe).join(" | "));
const marked = new Hidden(5);
Object.defineProperty(marked, "size", { value: "defined", writable: true, enumerable: true });
console.log(readAll([marked, new Hidden(6), marked, new Hidden(7)]), below, describe(marked));
console.log(makeReadOnly(50));
console.log(makeSeveral(100), several, Object.keys(new Several(1, 2)).length);
