// A store in a constructor creates its field until a setter, a read-only property, another prototype or a frozen object says otherwise.
var log = [];
var seen = [];

function join(parts) {
  return parts.join("");
}

class Base {
  constructor(label) {
    this.label = label;
    this.items = [];
    this.parent = null;
  }
}

class Derived extends Base {
  constructor(label, size) {
    super(label);
    this.size = size;
  }
}

function make(i) {
  return i % 2 ? new Derived("d" + i, i) : new Base("b" + i);
}

function describe(object) {
  return Object.keys(object).join() + " | " + object.label + " | " + object.size + " | " + object.parent;
}

var total = 0;
for (var i = 0; i < 2000; i++) total += Object.keys(make(i)).length;
log.push(total, describe(make(1)), describe(make(2)));

Object.defineProperty(Base.prototype, join(["la", "bel"]), {
  set(value) {
    seen.push("label " + value);
  },
  get() {
    return "from the getter";
  },
  configurable: true,
});
log.push(describe(make(3)), describe(make(4)), seen.join());
delete Base.prototype[join(["la", "bel"])];
log.push(describe(make(5)), describe(make(6)));

Object.defineProperty(Derived.prototype, join(["si", "ze"]), { value: 7, writable: false, configurable: true });
try {
  make(7);
  log.push("no error");
} catch (error) {
  log.push(error instanceof TypeError);
}
delete Derived.prototype[join(["si", "ze"])];
log.push(describe(make(7)));

var watcher = {
  set parent(value) {
    seen.push("parent " + value);
  },
};
Object.setPrototypeOf(Base.prototype, watcher);
log.push(describe(make(8)), describe(make(9)), seen.join());
Object.setPrototypeOf(Base.prototype, Object.prototype);
log.push(describe(make(10)), describe(make(11)));

function Other() {}
Other.prototype = {
  set items(value) {
    seen.push("items " + value.length);
  },
};
var constructedForOther = Reflect.construct(Base, ["r"], Other);
log.push(Object.keys(constructedForOther).join(), Object.getPrototypeOf(constructedForOther) === Other.prototype, seen.join());
var derivedForOther = Reflect.construct(Derived, ["s", 4], Other);
log.push(Object.keys(derivedForOther).join(), Object.getPrototypeOf(derivedForOther) === Other.prototype, seen.join());

class Frozen extends Base {
  constructor() {
    super("f");
    return Object.freeze(this);
  }
}
class AfterFrozen extends Frozen {
  constructor() {
    super();
    this.extra = 1;
  }
}
try {
  new AfterFrozen();
  log.push("no error");
} catch (error) {
  log.push(error instanceof TypeError);
}

class NotExtensible extends Base {
  constructor() {
    super("n");
    Object.preventExtensions(this);
  }
}
class AfterNotExtensible extends NotExtensible {
  constructor() {
    super();
    this.label = "stored";
    this.extra = 1;
  }
}
try {
  new AfterNotExtensible();
  log.push("no error");
} catch (error) {
  log.push(error instanceof TypeError);
}

class Watched extends Base {
  constructor() {
    super("w");
    Object.defineProperty(this, join(["ex", "tra"]), {
      set(value) {
        seen.push("own " + value);
      },
      configurable: true,
      enumerable: true,
    });
  }
}
class AfterWatched extends Watched {
  constructor() {
    super();
    this.extra = 2;
  }
}
log.push(Object.keys(new AfterWatched()).join(), seen.join());

class Plain extends Base {
  constructor() {
    super("p");
    this.extra = 3;
  }
}
log.push(describe(new Plain()), new Plain().extra);

function Point(x, y) {
  this.x = x;
  this.y = y;
  delete this.x;
  this.x = y;
}
log.push(Object.keys(new Point(1, 2)).join(), new Point(1, 2).x);

function Account(owner) {
  this.owner = owner;
  this.balance = 0;
}
var balances = 0;
for (var j = 0; j < 2000; j++) balances += Object.keys(new Account(j)).length;
Object.defineProperty(Account.prototype, join(["bal", "ance"]), {
  set(value) {
    seen.push("balance " + value);
  },
  configurable: true,
});
log.push(balances, Object.keys(new Account("z")).join(), seen.join());
Account.prototype = {
  set owner(value) {
    seen.push("owner " + value);
  },
};
log.push(Object.keys(new Account("y")).join(), seen.join());

console.log(log.join("\n"));
