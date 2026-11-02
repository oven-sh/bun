function copyOwn(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    if (Object.hasOwn(target, key)) continue;
    Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
  }
  return target;
}

const tag = Symbol("tag");
const methods = {
  first() {
    return "first of " + this.label;
  },
  second(n) {
    return this.first() + " and " + n;
  },
  get shout() {
    return this.label.toUpperCase();
  },
  set shout(value) {
    this.label = value.toLowerCase();
  },
  [tag]: 7,
};
Object.defineProperty(methods, "hidden", {
  value: () => "hidden",
  enumerable: false,
  writable: false,
  configurable: false,
});

function app() {
  return "called";
}
app.label = "app";
copyOwn(app, methods);
console.log(app(), app.first(), app.second(2), app.shout, app[tag], app.hidden());
app.shout = "LOUD";
console.log(app.label, Object.keys(app).join(), JSON.stringify(Object.getOwnPropertyDescriptor(app, "hidden")));

function copyWrapped(target, source) {
  for (const key of Object.getOwnPropertyNames(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (typeof descriptor.value === "function") {
      const inner = descriptor.value;
      descriptor.value = function () {
        return "[" + inner.apply(this, arguments) + "]";
      };
    }
    Object.defineProperty(target, key, descriptor);
  }
  return target;
}
const wrapped = copyWrapped({ label: "wrapped" }, methods);
console.log(wrapped.first(), wrapped.second(3), wrapped.shout, wrapped.hidden());

function copyRenamed(target, source, from, to) {
  Object.defineProperty(target, to, Object.getOwnPropertyDescriptor(source, from));
  return target;
}
const renamed = copyRenamed({ label: "renamed" }, methods, "first", "second");
console.log(renamed.second(), typeof renamed.first);

const kept = [];
function copyAndKeep(target, source, key) {
  const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
  kept.push(descriptor);
  Object.defineProperty(target, key, descriptor);
  return target;
}
const keeper = copyAndKeep({ label: "keeper" }, methods, "first");
kept[0].value = () => "changed later";
console.log(keeper.first(), kept[0].value());

try {
  copyRenamed({}, methods, "missing", "missing");
} catch (error) {
  console.log(error instanceof TypeError);
}

class Base {
  static make() {
    return new this();
  }
  name() {
    return "base";
  }
}
class Other {}
copyOwn(Other, Base);
copyOwn(Other.prototype, Base.prototype);
console.log(Other.make() instanceof Other, new Other().name(), Other.prototype.constructor === Other);

const list = copyOwn({}, [10, 20, 30]);
console.log(list[1], list.length, Object.keys(list).join());

const seen = [];
const proxy = new Proxy(methods, {
  getOwnPropertyDescriptor(target, key) {
    seen.push(String(key));
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
});
const throughProxy = copyOwn({ label: "proxy" }, proxy);
console.log(throughProxy.first(), seen.length);

const later = { label: "later" };
copyOwn(later, methods);
methods.first = () => "replaced in the source";
console.log(later.first(), methods.first());
