// Object.freeze, Object.seal, Object.preventExtensions and Reflect.preventExtensions on a Proxy without traps act on its target: an object that is closed so is closed as if it had been named itself.
// An instance of a class, an instance of a constructor function and a literal are closed each way: itself, through a Proxy, through a Proxy of a Proxy. Then each is stored to, added to and deleted from,
// in sloppy code, which drops what a closed object refuses, and in strict code, which throws. This file is sloppy, and the body of a class is strict wherever it stands.
// What a closed object does not refuse still goes through: a store to a private field, and a store that runs a setter of its own.
// Cut out of test/aot/parallel/node-http/objects-closed-proxies-without-traps.ts, without a server.
console.log(`this file is sloppy: ${(function () { return this !== undefined; })()}, and the body of a class is not: ${(class { static ask() { return (function () { return this === undefined; })(); } }).ask()}`);

class Pair {
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
  store(value) {
    this.a = value;
  }
  add(value) {
    this.c = value;
  }
  remove() {
    return delete this.b;
  }
}

function Couple(a, b) {
  this.a = a;
  this.b = b;
}
Couple.prototype.store = function (value) {
  this.a = value;
};
Couple.prototype.add = function (value) {
  this.c = value;
};
Couple.prototype.remove = function () {
  return delete this.b;
};

function storeSloppy(object, value) {
  object.a = value;
}
function addSloppy(object, value) {
  object.c = value;
}
function removeSloppy(object) {
  return delete object.b;
}
function storeByKeySloppy(object, key, value) {
  object[key] = value;
}
function aroundSloppy(object, close) {
  object.a = 2;
  close(object);
  object.a = 3;
  return object.a;
}
function inTurnsSloppy(object, close) {
  for (let turn = 0; turn < 6; turn++) {
    if (turn === 3) close(object);
    object.a = turn;
  }
  return object.a;
}

class Strict {
  static store(object, value) {
    object.a = value;
  }
  static add(object, value) {
    object.c = value;
  }
  static remove(object) {
    return delete object.b;
  }
  static storeByKey(object, key, value) {
    object[key] = value;
  }
  static around(object, close) {
    object.a = 2;
    close(object);
    object.a = 3;
    return object.a;
  }
  static inTurns(object, close) {
    for (let turn = 0; turn < 6; turn++) {
      if (turn === 3) close(object);
      object.a = turn;
    }
    return object.a;
  }
}

function attempt(operation) {
  try {
    const answer = operation();
    return answer === undefined ? "done" : String(answer);
  } catch (error) {
    return error.name;
  }
}

function describeState(object) {
  return `${Object.isExtensible(object) ? "open" : "closed"}${Object.isSealed(object) ? " sealed" : ""}${Object.isFrozen(object) ? " frozen" : ""}`;
}

function describe(object) {
  const form = key => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return `no ${key}`;
    return `${key}=${descriptor.value}${descriptor.writable ? "w" : ""}${descriptor.enumerable ? "e" : ""}${descriptor.configurable ? "c" : ""}`;
  };
  return `${form("a")} ${form("b")} ${form("c")} ${form("d")} [${Reflect.ownKeys(object).join()}] ${describeState(object)}`;
}

const levels = [
  ["nothing", object => object],
  ["freeze", object => Object.freeze(object)],
  ["seal", object => Object.seal(object)],
  ["preventExtensions", object => Object.preventExtensions(object)],
  ["Reflect.preventExtensions", object => Reflect.preventExtensions(object)],
];
const ways = [
  ["itself", object => object],
  ["a Proxy", object => new Proxy(object, {})],
  ["a Proxy of a Proxy", object => new Proxy(new Proxy(object, {}), {})],
];
const makers = [
  ["an instance of a class", () => new Pair(1, "x")],
  ["an instance of a function", () => new Couple(1, "x")],
  ["a literal", () => ({ a: 1, b: "x" })],
];

let unlike = 0;
function tell(title, row, expected) {
  console.log(`${title}: ${row}`);
  if (row === expected) return;
  unlike++;
  console.log(`UNLIKE the object closed itself: ${expected}`);
}

for (const [kind, make] of makers) {
  for (const [level, close] of levels) {
    let expected;
    for (const [way, wrap] of ways) {
      for (const usesWrapped of way === "itself" ? [false] : [false, true]) {
        const parts = [];
        for (const isStrict of [false, true]) {
          const object = make();
          if (isStrict) Strict.store(object, 2);
          else storeSloppy(object, 2);
          const wrapped = wrap(object);
          close(wrapped);
          const used = usesWrapped ? wrapped : object;
          parts.push(
            isStrict
              ? [
                  attempt(() => Strict.store(used, 3)),
                  attempt(() => Strict.add(used, 4)),
                  attempt(() => Strict.remove(used)),
                  attempt(() => Strict.storeByKey(used, "a", 5)),
                  attempt(() => Strict.storeByKey(used, "d", 6)),
                ].join(" ")
              : [
                  attempt(() => storeSloppy(used, 3)),
                  attempt(() => addSloppy(used, 4)),
                  attempt(() => removeSloppy(used)),
                  attempt(() => storeByKeySloppy(used, "a", 5)),
                  attempt(() => storeByKeySloppy(used, "d", 6)),
                ].join(" "),
          );
          parts.push(describe(object));
          if (describe(wrapped) !== describe(object)) parts.push(`what stands for it says ${describe(wrapped)}`);
        }
        const row = parts.join(" | ");
        expected ??= row;
        tell(`${kind}, ${level} ${way}, used ${usesWrapped ? "as that" : "itself"}`, row, expected);
      }
    }
  }
}

for (const [kind, make] of makers.slice(0, 2)) {
  for (const [level, close] of levels) {
    let expected;
    for (const [way, wrap] of ways) {
      const object = make();
      object.store(2);
      close(wrap(object));
      const row = `${attempt(() => object.store(3))} ${attempt(() => object.add(4))} ${attempt(() => object.remove())} | ${describe(object)}`;
      expected ??= row;
      tell(`${kind} by its own methods, ${level} ${way}`, row, expected);
    }
  }
}

for (const [kind, make] of makers) {
  for (const [level, close] of levels) {
    let expected;
    for (const [way, wrap] of ways) {
      const closeSo = object => void close(wrap(object));
      const row = [
        attempt(() => aroundSloppy(make(), closeSo)),
        attempt(() => Strict.around(make(), closeSo)),
        attempt(() => inTurnsSloppy(make(), closeSo)),
        attempt(() => Strict.inTurns(make(), closeSo)),
      ].join(" ");
      expected ??= row;
      tell(`${kind}, ${level} ${way} between stores`, row, expected);
    }
  }
}

function inSightSloppy() {
  const frozen = new Pair(1, "x");
  Object.freeze(new Proxy(frozen, {}));
  frozen.a = 2;
  frozen.c = 3;
  const removedOfFrozen = delete frozen.b;
  const sealed = new Couple(1, "x");
  Object.seal(new Proxy(sealed, {}));
  sealed.a = 2;
  sealed.c = 3;
  const removedOfSealed = delete sealed.b;
  const closed = { a: 1, b: "x" };
  Reflect.preventExtensions(new Proxy(new Proxy(closed, {}), {}));
  closed.a = 2;
  closed.c = 3;
  const removedOfClosed = delete closed.b;
  return `${frozen.a} ${frozen.b} ${frozen.c} ${removedOfFrozen} | ${sealed.a} ${sealed.b} ${sealed.c} ${removedOfSealed} | ${closed.a} ${closed.b} ${closed.c} ${removedOfClosed}`;
}
console.log(`made and closed in sight, sloppy: ${inSightSloppy()}`);

class InSight {
  static run() {
    const seen = [];
    const frozen = new Pair(1, "x");
    Object.freeze(new Proxy(frozen, {}));
    try {
      frozen.a = 2;
      seen.push("stored");
    } catch (error) {
      seen.push(error.name);
    }
    try {
      frozen.c = 3;
      seen.push("added");
    } catch (error) {
      seen.push(error.name);
    }
    try {
      seen.push(String(delete frozen.b));
    } catch (error) {
      seen.push(error.name);
    }
    seen.push(`${frozen.a} ${frozen.b} ${frozen.c} |`);
    const sealed = { a: 1, b: "x" };
    Object.seal(new Proxy(sealed, {}));
    try {
      sealed.a = 2;
      seen.push("stored");
    } catch (error) {
      seen.push(error.name);
    }
    try {
      sealed.c = 3;
      seen.push("added");
    } catch (error) {
      seen.push(error.name);
    }
    try {
      seen.push(String(delete sealed.b));
    } catch (error) {
      seen.push(error.name);
    }
    seen.push(`${sealed.a} ${sealed.b} ${sealed.c}`);
    return seen.join(" ");
  }
}
console.log(`made and closed in sight, strict: ${InSight.run()}`);

const showMade = made => `${JSON.stringify(made)} ${made.c} ${made.read()}`;

function BaseFrozen() {}
BaseFrozen.prototype.c = 0;
BaseFrozen.prototype.read = function () {
  return "read " + this.a;
};
function MadeFrozen(x) {
  this.a = x;
  this.c = x + 2;
}
Object.setPrototypeOf(MadeFrozen.prototype, BaseFrozen.prototype);
console.log(`functions, before: ${showMade(new MadeFrozen(1))}`);
Object.freeze(new Proxy(BaseFrozen.prototype, {}));
console.log(`functions, what is above frozen through a Proxy: ${showMade(new MadeFrozen(2))}`);
BaseFrozen.prototype.read = function () {
  return "replaced";
};
BaseFrozen.prototype.added = 1;
console.log(`functions, what is above stored to: ${showMade(new MadeFrozen(3))} ${"added" in BaseFrozen.prototype} ${describeState(BaseFrozen.prototype)}`);

function BaseSealed() {}
BaseSealed.prototype.c = 0;
BaseSealed.prototype.read = function () {
  return "read " + this.a;
};
function MadeSealed(x) {
  this.a = x;
  this.c = x + 2;
}
Object.setPrototypeOf(MadeSealed.prototype, BaseSealed.prototype);
console.log(`functions, before: ${showMade(new MadeSealed(1))}`);
Object.seal(new Proxy(BaseSealed.prototype, {}));
console.log(`functions, what is above sealed through a Proxy: ${showMade(new MadeSealed(2))}`);
BaseSealed.prototype.read = function () {
  return "replaced";
};
BaseSealed.prototype.added = 1;
console.log(`functions, what is above stored to: ${showMade(new MadeSealed(3))} ${"added" in BaseSealed.prototype} ${describeState(BaseSealed.prototype)}`);

class ParentFrozen {
  read() {
    return "read " + this.a;
  }
}
ParentFrozen.prototype.c = 0;
class ChildFrozen extends ParentFrozen {
  constructor(x) {
    super();
    this.a = x;
    this.c = x + 2;
  }
}
console.log(`classes, before: ${attempt(() => showMade(new ChildFrozen(1)))}`);
Object.freeze(new Proxy(ParentFrozen.prototype, {}));
console.log(`classes, what is above frozen through a Proxy: ${attempt(() => showMade(new ChildFrozen(2)))}`);

class ParentClosed {
  read() {
    return "read " + this.a;
  }
}
ParentClosed.prototype.c = 0;
class ChildClosed extends ParentClosed {
  constructor(x) {
    super();
    this.a = x;
    this.c = x + 2;
  }
}
console.log(`classes, before: ${attempt(() => showMade(new ChildClosed(1)))}`);
Reflect.preventExtensions(new Proxy(ParentClosed.prototype, {}));
console.log(`classes, what is above closed through a Proxy: ${attempt(() => showMade(new ChildClosed(2)))} ${describeState(ParentClosed.prototype)}`);

class Counter {
  static count = 0;
  static bump() {
    return ++Counter.count;
  }
}
console.log(`a class object, before: ${attempt(() => Counter.bump())}`);
Object.freeze(new Proxy(Counter, {}));
console.log(`a class object frozen through a Proxy, strict: ${attempt(() => Counter.bump())}`);
Counter.count = 9;
Counter.added = 1;
console.log(`a class object frozen through a Proxy, sloppy: ${Counter.count} ${"added" in Counter} ${describeState(Counter)}`);

for (const [level, close] of levels) {
  let expected;
  for (const [way, wrap] of ways) {
    const list = [1, 2, 3];
    storeByKeySloppy(list, 0, 4);
    close(wrap(list));
    const row = [
      attempt(() => storeByKeySloppy(list, 1, 5)),
      attempt(() => Strict.storeByKey(list, 1, 6)),
      attempt(() => storeByKeySloppy(list, 3, 7)),
      attempt(() => Strict.storeByKey(list, 3, 8)),
      attempt(() => list.push(9)),
      attempt(() => list.pop()),
      `| ${list.join()} ${list.length} ${describeState(list)}`,
    ].join(" ");
    expected ??= row;
    tell(`a list, ${level} ${way}`, row, expected);
  }
}

const mark = Symbol("mark");
class Held {
  #n = 0;
  a = 1;
  set(value) {
    this.#n = value;
    return this.#n;
  }
}
function makeWatched(seen) {
  return {
    a: 1,
    get v() {
      return seen.length;
    },
    set v(value) {
      seen.push(value);
    },
    [mark]: 1,
  };
}
function storeToSetterSloppy(object, value) {
  object.v = value;
}
function storeUnderSymbolSloppy(object, value) {
  object[mark] = value;
}
class StrictToo {
  static storeToSetter(object, value) {
    object.v = value;
  }
  static storeUnderSymbol(object, value) {
    object[mark] = value;
  }
}
function describeWatched(object) {
  const accessor = Object.getOwnPropertyDescriptor(object, "v");
  const marked = Object.getOwnPropertyDescriptor(object, mark);
  const keys = Reflect.ownKeys(object).map(String).join();
  return `v=${typeof accessor.get},${typeof accessor.set}${accessor.enumerable ? "e" : ""}${accessor.configurable ? "c" : ""} mark=${marked.value}${marked.writable ? "w" : ""}${marked.enumerable ? "e" : ""}${marked.configurable ? "c" : ""} [${keys}] ${describeState(object)}`;
}

for (const [level, close] of levels) {
  let expected;
  for (const [way, wrap] of ways) {
    const held = new Held();
    held.set(1);
    close(wrap(held));
    const seen = [];
    const watched = makeWatched(seen);
    storeToSetterSloppy(watched, 1);
    StrictToo.storeUnderSymbol(watched, 2);
    close(wrap(watched));
    const row = [
      attempt(() => held.set(5)),
      attempt(() => held.set(6)),
      `${held.a} ${describeState(held)} |`,
      attempt(() => storeToSetterSloppy(watched, 7)),
      attempt(() => StrictToo.storeToSetter(watched, 8)),
      `${seen.join()} ${watched.v} |`,
      attempt(() => storeUnderSymbolSloppy(watched, 3)),
      attempt(() => StrictToo.storeUnderSymbol(watched, 4)),
      `${watched[mark]} | ${describeWatched(watched)}`,
    ].join(" ");
    expected ??= row;
    tell(`a private field, a setter and a field under a symbol, ${level} ${way}`, row, expected);
  }
}

function stillGoesThroughInSight() {
  const held = new Held();
  Object.freeze(new Proxy(held, {}));
  const seen = [];
  const watched = {
    a: 1,
    get v() {
      return seen.length;
    },
    set v(value) {
      seen.push(value);
    },
    [mark]: 1,
  };
  Object.freeze(new Proxy(watched, {}));
  watched.v = 7;
  watched.a = 2;
  watched[mark] = 2;
  return `${held.set(5)} ${held.a} | ${seen.join()} ${watched.v} ${watched.a} ${watched[mark]}`;
}
console.log(`made and frozen in sight, what still goes through: ${stillGoesThroughInSight()}`);

console.log(`${unlike} unlike the object closed itself`);
process.exitCode = unlike ? 1 : 0;
