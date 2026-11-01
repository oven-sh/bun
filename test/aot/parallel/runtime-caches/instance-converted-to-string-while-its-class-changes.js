// A template literal converts an instance of a class with its own toString() many times, then the class, its parent or the instance changes.
function text(value) {
  try {
    return `${value}`;
  } catch (error) {
    return `${error.constructor.name}: ${error.message}`;
  }
}
function often(value) {
  let last = "";
  for (let i = 0; i < 40; i++) last = text(value);
  return last;
}

class Id {
  n;
  constructor(n) {
    this.n = n;
  }
  toString() {
    return "id" + this.n;
  }
}
class Tagged extends Id {}
class Loud extends Id {
  toString() {
    return super.toString().toUpperCase();
  }
}

const id = new Id(1);
console.log(often(id), often(new Tagged(2)), often(new Loud(3)), String(id), [id, new Loud(4)].join());

Id.prototype.toString = function () {
  return "replaced" + this.n;
};
console.log(often(id), often(new Tagged(2)), often(new Loud(3)));

const own = new Id(5);
console.log(often(own));
own.toString = () => "own";
console.log(often(own), often(id));
delete own.toString;
console.log(often(own));

for (const answer of [7, -0, 1.5, undefined, null, true, 12n, "", Symbol("s"), {}, [], () => 1]) {
  class Answers {
    toString() {
      return answer;
    }
  }
  console.log(typeof answer, often(new Answers()));
}

class ThroughValueOf {
  toString() {
    return {};
  }
  valueOf() {
    return 42;
  }
}
console.log(often(new ThroughValueOf()));
ThroughValueOf.prototype.valueOf = () => ({});
console.log(often(new ThroughValueOf()));
ThroughValueOf.prototype.valueOf = 3;
console.log(often(new ThroughValueOf()));

class Exotic {
  toString() {
    return "plain";
  }
}
const exotic = new Exotic();
console.log(often(exotic));
Exotic.prototype[Symbol.toPrimitive] = hint => "hint " + hint;
console.log(often(exotic));
Exotic.prototype[Symbol.toPrimitive] = undefined;
console.log(often(exotic));
Exotic.prototype[Symbol.toPrimitive] = 1;
console.log(often(exotic));
Exotic.prototype[Symbol.toPrimitive] = () => ({});
console.log(often(exotic));
delete Exotic.prototype[Symbol.toPrimitive];
console.log(often(exotic));

class Removed {
  toString() {
    return "before";
  }
}
const removed = new Removed();
console.log(often(removed));
delete Removed.prototype.toString;
console.log(often(removed));
Removed.prototype[Symbol.toStringTag] = "Tag";
console.log(often(removed));

let reads = 0;
class Counted {
  toString() {
    return "method";
  }
}
const counted = new Counted();
console.log(often(counted));
Object.defineProperty(Counted.prototype, "toString", {
  get() {
    reads++;
    return () => "getter";
  },
  configurable: true,
});
console.log(often(counted), reads);
Object.defineProperty(Counted.prototype, "toString", { value: 5, configurable: true });
console.log(often(counted), reads);

class Moved {
  toString() {
    return "first";
  }
}
const moved = new Moved();
console.log(often(moved));
Object.setPrototypeOf(moved, {
  toString() {
    return "second";
  },
});
console.log(often(moved), often(new Moved()));
Object.setPrototypeOf(moved, null);
console.log(often(moved));
Object.setPrototypeOf(Moved.prototype, {
  [Symbol.toPrimitive]() {
    return "from above";
  },
});
console.log(often(new Moved()));

class BelowProxy {
  toString() {
    return "below";
  }
}
const seen = [];
console.log(often(new BelowProxy()));
Object.setPrototypeOf(
  BelowProxy.prototype,
  new Proxy(
    {},
    {
      get(target, key) {
        if (seen.length < 4) seen.push(String(key));
        return undefined;
      },
    },
  ),
);
console.log(often(new BelowProxy()), seen.join());

class Native {}
Native.prototype.toString = Array.prototype.join;
console.log(often(new Native()));
Native.prototype.toString = function () {
  return "bound " + this.name;
}.bind({ name: "receiver" });
console.log(often(new Native()));

class Field {
  toString = () => "field";
}
console.log(often(new Field()), often(Object.freeze(new Id(6))), often(Object.seal(new Loud(7))));

class Throws {
  toString() {
    throw new RangeError("thrown by toString");
  }
}
console.log(often(new Throws()));

class Frames {
  toString() {
    return new Error("x").stack
      .split("\n")
      .slice(1, 3)
      .map(line => line.trim().split(" ")[1])
      .join("<");
  }
}
function caller(value) {
  return `${value}`;
}
for (let i = 0; i < 3; i++) console.log(caller(new Frames()));

class Nested {
  constructor(inner) {
    this.inner = inner;
  }
  toString() {
    return `(${this.inner})`;
  }
}
console.log(often(new Nested(new Nested(new Nested(id)))));

class Endless {
  toString() {
    return `${this}`;
  }
}
console.log(text(new Endless()).slice(0, 10));

class Changes {
  toString() {
    Changes.prototype.toString = () => "changed by the call";
    return "first call";
  }
}
const changes = new Changes();
console.log(text(changes), text(changes));
