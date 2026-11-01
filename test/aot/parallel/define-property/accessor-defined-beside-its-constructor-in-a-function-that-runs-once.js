function describe(object) {
  return [object.size, Object.hasOwn(object, "size"), "size" in object, Object.keys(object).join(), JSON.stringify(object)].join(" ");
}

var taken = 0;
var Sized = (function () {
  function Sized(size) {
    this.stored = 0;
    this.size = size;
    this.extra = 1;
  }
  Object.defineProperty(Sized.prototype, "size", {
    get: function () {
      return this.stored * 2;
    },
    set: function (value) {
      taken += value;
      this.stored = value;
    },
    enumerable: false,
    configurable: true,
  });
  return Sized;
})();
function sumOf(rounds) {
  var sum = 0;
  for (var round = 0; round < rounds; round++) {
    var made = new Sized(round & 7);
    sum += made.size + made.extra;
  }
  return sum;
}

let inClass = 0;
function makeClass() {
  class Inner {
    constructor(size) {
      this.size = size;
      this.extra = 1;
    }
  }
  Object.defineProperty(Inner.prototype, "size", {
    set(value) {
      inClass += value;
    },
    get() {
      return 5;
    },
  });
  return Inner;
}
const Inner = makeClass();
function sumOfInner(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const made = new Inner(round & 7);
    sum += made.size + made.extra;
  }
  return sum;
}

let nested = 0;
const Nested = (function () {
  return (function () {
    function Nested(size) {
      this.size = size;
    }
    Object.defineProperty(Nested.prototype, "size", {
      set(value) {
        nested += value;
      },
      get() {
        return 6;
      },
    });
    return Nested;
  })();
})();
function sumOfNested(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += new Nested(round & 7).size;
  return sum;
}

let late = 0;
let madeEarly;
const Late = (function () {
  function Late(size) {
    this.size = size;
  }
  madeEarly = [new Late(1), new Late(2)];
  Object.defineProperty(Late.prototype, "size", {
    set(value) {
      late += value;
    },
    get() {
      return 8;
    },
  });
  return Late;
})();
function sumOfLate(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += new Late(round & 7).size;
  return sum;
}

let twice = "";
function makeTwice(label) {
  function Twice(size) {
    this.size = size;
  }
  Object.defineProperty(Twice.prototype, "size", {
    set(value) {
      twice += label + value;
    },
    get() {
      return label;
    },
  });
  return Twice;
}
const One = makeTwice("a");
const Two = makeTwice("b");
function readTwice(rounds) {
  let text = "";
  for (let round = 0; round < rounds; round++) text += new One(round).size + new Two(round).size;
  return text;
}

let byCallback = 0;
let ByCallback;
[0].forEach(function () {
  ByCallback = function (size) {
    this.size = size;
  };
  Object.defineProperty(ByCallback.prototype, "size", {
    set(value) {
      byCallback += value;
    },
    get() {
      return 9;
    },
  });
});
function sumByCallback(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += new ByCallback(round & 7).size;
  return sum;
}

const Counted = (function () {
  let count = 0;
  const step = 3;
  function Counted(size) {
    this.size = size;
  }
  Object.defineProperty(Counted.prototype, "size", {
    set(value) {
      count += value * step;
    },
    get() {
      return count;
    },
  });
  return Counted;
})();
function sumOfCounted(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += new Counted(round & 7).size;
  return sum;
}

let reachedFirst = 0;
function Reached(size) {
  this.size = size;
}
function makeOne() {
  return new Reached(11);
}
const before = makeOne();
(function () {
  Object.defineProperty(Reached.prototype, "size", {
    set(value) {
      reachedFirst += value;
    },
    get() {
      return 12;
    },
  });
})();
function sumOfReached(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += new Reached(round & 7).size;
  return sum;
}

console.log(sumOf(1000), taken, describe(new Sized(1)));
console.log(sumOfInner(1000), inClass, describe(new Inner(1)));
console.log(sumOfNested(1000), nested, describe(new Nested(1)));
console.log(sumOfLate(1000), late, madeEarly.map(describe).join(" | "), describe(new Late(1)));
console.log(readTwice(4), twice, describe(new One(1)), describe(new Two(1)));
console.log(sumByCallback(1000), byCallback, describe(new ByCallback(1)));
console.log(sumOfCounted(1000), describe(new Counted(1)));
console.log(sumOfReached(1000), reachedFirst, describe(before), describe(new Reached(1)));
delete Sized.prototype.size;
console.log(sumOf(1000), taken, describe(new Sized(1)));
