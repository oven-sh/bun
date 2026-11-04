// super(..) where the parent is a class of the program at one evaluation and something else at another: a built-in, a proxy, a bound function, null, whatever Object.setPrototypeOf() puts there.
class Plain {
  constructor(...list) {
    this.kind = "plain";
    this.count = list.length;
  }
}
class Other {
  constructor(...list) {
    this.kind = "other";
    this.count = list.length * 10;
  }
}
function Old(first) {
  this.kind = "old";
  this.count = first;
}

const Mix = Base =>
  class Mixed extends Base {
    constructor(...list) {
      super(...list);
      this.mixed = true;
    }
  };

function show(label, make) {
  try {
    const made = make();
    console.log(label, made.kind, made.count, made.mixed, made.length, made.size, made.message);
    console.log(label, made instanceof Plain, made instanceof Other, made instanceof Old);
  } catch (error) {
    console.log(label, "throws", error instanceof TypeError ? "TypeError" : String(error));
  }
}

show("plain", () => new (Mix(Plain))(1, 2));
show("other", () => new (Mix(Other))(1, 2));
show("old", () => new (Mix(Old))(7));
show("array of a length", () => new (Mix(Array))(3));
show("array of elements", () => new (Mix(Array))(3, 4));
show("map", () => new (Mix(Map))([[1, 2]]));
show("error", () => new (Mix(Error))("message"));
show("object", () => new (Mix(Object))(1));
show("null", () => new (Mix(null))());

const bound = Plain.bind(null, "bound");
bound.prototype = Plain.prototype;
show("bound function", () => new (Mix(bound))(1));

const traps = [];
const proxied = new Proxy(Plain, {
  construct(target, list, newTarget) {
    traps.push(`construct ${list.length} ${newTarget.name}`);
    return Reflect.construct(target, list, newTarget);
  },
});
show("proxy", () => new (Mix(proxied))(1, 2, 3));
console.log(traps.join());

// The link above the class object decides, not the class as it was defined.
const Swapped = Mix(Plain);
show("before the swap", () => new Swapped(1));
Object.setPrototypeOf(Swapped, Other);
show("after the swap", () => new Swapped(1));
Object.setPrototypeOf(Swapped, () => {});
show("above an arrow function", () => new Swapped(1));
Object.setPrototypeOf(Swapped, null);
show("above null", () => new Swapped(1));

// The parent is read in front of the arguments.
const MixThatSwaps = Base =>
  class Swapping extends Base {
    constructor(next) {
      super(Object.setPrototypeOf(Swapping, next) && 1);
    }
  };
const SwapsFromPlain = MixThatSwaps(Plain);
const SwapsFromOther = MixThatSwaps(Other);
show("plain, then other", () => new SwapsFromPlain(Other));
show("other, then plain", () => new SwapsFromPlain(Plain));
show("other, then old", () => new SwapsFromOther(Old));
show("old, then other", () => new SwapsFromOther(Other));

// A class object that has changed since it was made is the same parent.
Plain.extra = 1;
Object.defineProperty(Other, "name", { value: "Renamed" });
Object.freeze(Other);
Old.prototype = { renewed: true };
show("plain with a property", () => new (Mix(Plain))(1));
show("other, renamed and frozen", () => new (Mix(Other))(1));
show("old with another prototype object", () => new (Mix(Old))(1));

// new.target is none of the classes below the parent.
show("new.target is another class", () => Reflect.construct(Mix(Plain), [1], Other));
show("new.target is a function", () => Reflect.construct(Mix(Old), [1], Old));
const reads = [];
const watched = new Proxy(function () {}, {
  get(target, key, receiver) {
    reads.push(String(key));
    return Reflect.get(target, key, receiver);
  },
});
show("new.target is a proxy", () => Reflect.construct(Mix(Plain), [1], watched));
show("new.target is a proxy, the parent a function", () => Reflect.construct(Mix(Old), [1], watched));
console.log(reads.join());
