// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) copies every own property as it stands: accessors stay
// accessors, attributes stay, symbols and indexes come along, in the order of the language. Nothing tells whether objects that describe
// the properties were made on the way, so here is all that could tell.
const lines = [];
const say = (...words) => lines.push(words.join(" "));

function describe(object) {
  return Reflect.ownKeys(object)
    .map(key => {
      const { value, get, set, writable, enumerable, configurable } = Object.getOwnPropertyDescriptor(object, key);
      const marks = (writable ? "w" : "-") + (enumerable ? "e" : "-") + (configurable ? "c" : "-");
      const held = get || set ? `${get ? "get" : ""}${set ? "set" : ""}` : typeof value === "function" ? "function" : String(value);
      return `${String(key)}:${marks}:${held}`;
    })
    .join(" ");
}

function attempt(title, run) {
  try {
    say(title, "->", run());
  } catch (error) {
    // Plain Bun quotes the source behind some messages.
    say(title, "threw", error.name + ":", error.message.replace(/ \(evaluating .*$/, ""));
  }
}

const copyOnto = (target, source) => Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));

const tag = Symbol("tag");
const defaults = { isEnabled: () => true, aliases: [], label: "default" };

attempt("accessors stay accessors", () => {
  let reads = 0;
  const source = {
    name: "a",
    get schema() {
      reads++;
      return this.name + reads;
    },
    set schema(value) {
      this.stored = value;
    },
    call(input) {
      return input;
    },
  };
  const built = Object.defineProperties({ ...defaults, shown: () => source.name }, Object.getOwnPropertyDescriptors(source));
  const readsWhileCopying = reads;
  built.name = "b";
  built.schema = 7;
  return [describe(built), readsWhileCopying, built.schema, built.stored, source.stored, built.call(3), built.shown()].join(" | ");
});

attempt("the result is the target", () => {
  const target = { a: 1 };
  return Object.defineProperties(target, Object.getOwnPropertyDescriptors({ b: 2 })) === target;
});

attempt("attributes stay", () => {
  const source = {};
  Object.defineProperty(source, "hidden", { value: 1, enumerable: false, writable: true, configurable: true });
  Object.defineProperty(source, "fixed", { value: 2, enumerable: true, writable: false, configurable: false });
  Object.defineProperty(source, "getterAlone", { get: () => 3, enumerable: false, configurable: false });
  Object.defineProperty(source, "setterAlone", { set(value) {}, enumerable: true, configurable: true });
  const built = Object.defineProperties({ hidden: "was here", other: 0 }, Object.getOwnPropertyDescriptors(source));
  return [describe(built), Object.keys(built).join(), JSON.stringify(built)].join(" | ");
});

attempt("symbols and indexes, in the order of the language", () => {
  const source = { z: 1, [tag]: 2, 10: 3, a: 4, 2: 5, [Symbol.iterator]: 6 };
  return describe(Object.defineProperties({ first: 0, 7: 7 }, Object.getOwnPropertyDescriptors(source)));
});

attempt("a property that is there is replaced where it stands", () => {
  const built = Object.defineProperties({ a: 1, b: 2, c: 3 }, Object.getOwnPropertyDescriptors({ c: "C", a: "A", d: "D" }));
  return describe(built);
});

attempt("a data property becomes an accessor and back", () => {
  const built = Object.defineProperties({ a: 1, get b() { return 2; } }, Object.getOwnPropertyDescriptors({ get a() { return "a"; }, b: "b" }));
  return [describe(built), built.a, built.b].join(" | ");
});

attempt("target and source are one object", () => {
  const object = { a: 1, get b() { return this.a; }, [tag]: 3 };
  Object.defineProperty(object, "c", { value: 4 });
  const before = describe(object);
  return [Object.defineProperties(object, Object.getOwnPropertyDescriptors(object)) === object, describe(object) === before, before].join(" | ");
});

attempt("a frozen source", () => {
  const built = Object.defineProperties({ a: 0, z: 0 }, Object.getOwnPropertyDescriptors(Object.freeze({ a: 1, b: 2, get c() { return 3; } })));
  return [describe(built), Object.isFrozen(built), Object.isExtensible(built)].join(" | ");
});
attempt("a sealed source", () => describe(Object.defineProperties({ a: 0 }, Object.getOwnPropertyDescriptors(Object.seal({ a: 1, b: 2 })))));

attempt("an own property named __proto__", () => {
  const built = Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors({ ["__proto__"]: "own", b: 2 }));
  return [describe(built), Object.getPrototypeOf(built) === Object.prototype, built.__proto__].join(" | ");
});

attempt("a value of another kind for a property that is there", () => {
  const target = { count: 1, label: "one", nested: { deep: true }, list: [1] };
  const built = Object.defineProperties(target, Object.getOwnPropertyDescriptors({ count: "many", label: 2, nested: null, list: () => 3 }));
  return [describe(built), typeof built.count, typeof built.label, built.nested, built.list()].join(" | ");
});

attempt("a property that was deleted comes back at the end", () => {
  const target = { a: 1, b: 2, c: 3 };
  delete target.a;
  return describe(Object.defineProperties(target, Object.getOwnPropertyDescriptors({ a: "again", d: 4 })));
});

attempt("names that were added one by one are replaced where they stand", () => {
  const target = { a: 1 };
  target.added = 2;
  target.more = 3;
  Object.defineProperty(target, "hidden", { value: 4, configurable: true });
  return describe(Object.defineProperties(target, Object.getOwnPropertyDescriptors({ more: "M", hidden: "H", added: "A", get a() { return "getter"; } })));
});

attempt("new names around a property that some targets of the kind have and this one lacks", () => {
  const make = withOptional => {
    const target = { a: 1 };
    if (withOptional) target.optional = "there";
    return target;
  };
  const source = { x: 1, optional: 2, y: 3, get z() { return 4; }, a: 5, w: 6 };
  return [make(false), make(true)].map(target => describe(Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)))).join(" / ");
});

attempt("an instance as target", () => {
  class Target {
    field = 1;
    other = "x";
    get computed() {
      return "inherited";
    }
  }
  const built = Object.defineProperties(new Target(), Object.getOwnPropertyDescriptors({ field: 2, computed: "own", extra: 3 }));
  return [describe(built), built.computed, built instanceof Target].join(" | ");
});

attempt("an empty source", () => describe(Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors({}))));

{
  const target = Object.freeze({ a: 1, b: 2 });
  attempt("a frozen target takes what changes nothing", () => describe(Object.defineProperties(target, Object.getOwnPropertyDescriptors(Object.freeze({ a: 1 })))));
  attempt("a frozen target", () => describe(Object.defineProperties(target, Object.getOwnPropertyDescriptors({ a: 1, b: 3 }))));
  say("and is", describe(target));
}

{
  const target = { a: 1 };
  Object.defineProperty(target, "fixed", { value: 1, configurable: false, writable: false, enumerable: true });
  attempt("it stops at the first property that is refused", () => describe(Object.defineProperties(target, Object.getOwnPropertyDescriptors({ a: 2, fixed: 2, late: 3 }))));
  say("and what came before it stays:", describe(target));
}

{
  const target = Object.preventExtensions({ a: 1 });
  attempt("a target that takes no new property", () => describe(Object.defineProperties(target, Object.getOwnPropertyDescriptors({ a: 2, b: 3 }))));
  say("and is", describe(target));
}

{
  const steps = [];
  const source = new Proxy(
    { a: 1, get b() { return 2; } },
    {
      ownKeys(object) {
        steps.push("ownKeys");
        return Reflect.ownKeys(object);
      },
      getOwnPropertyDescriptor(object, key) {
        steps.push("describe " + String(key));
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
    },
  );
  const target = new Proxy(
    {},
    {
      defineProperty(object, key, descriptor) {
        steps.push("define " + String(key) + " " + Object.keys(descriptor).join());
        return Reflect.defineProperty(object, key, descriptor);
      },
    },
  );
  attempt("every property of a Proxy is described before the first is defined", () => describe(Object.defineProperties(target, Object.getOwnPropertyDescriptors(source))));
  say(steps.join("; "));
}

{
  const steps = [];
  const source = new Proxy({ a: 1, b: 2 }, {
    getOwnPropertyDescriptor(object, key) {
      steps.push("describe " + key);
      if (key === "b") throw new RangeError("no b");
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
  });
  const target = {};
  attempt("a trap that throws leaves the target alone", () => describe(Object.defineProperties(target, Object.getOwnPropertyDescriptors(source))));
  say(steps.join("; "), "|", describe(target));
}

attempt("an array as source", () => describe(Object.defineProperties({}, Object.getOwnPropertyDescriptors(["x", "y"]))));
attempt("an array as target", () => {
  const target = [1, 2, 3];
  Object.defineProperties(target, Object.getOwnPropertyDescriptors({ 0: "x", length: 2 }));
  return JSON.stringify(target);
});
attempt("a string as source", () => describe(Object.defineProperties({}, Object.getOwnPropertyDescriptors("ab"))));
attempt("a function as source", () => {
  function named(a, b) {}
  named.extra = 1;
  return describe(Object.defineProperties({}, Object.getOwnPropertyDescriptors(named)));
});
attempt("a class as target", () => {
  class Target {
    static kept = 1;
  }
  return describe(Object.defineProperties(Target, Object.getOwnPropertyDescriptors({ added: 2, get computed() { return 3; } })));
});
attempt("an instance as source", () => {
  class Source {
    field = 1;
    #hidden = 2;
    method() {}
    get inherited() {
      return this.#hidden;
    }
  }
  return describe(Object.defineProperties({}, Object.getOwnPropertyDescriptors(new Source())));
});
attempt("a prototype as source", () => {
  class Source {
    method() {
      return "method";
    }
    get computed() {
      return "computed";
    }
  }
  const built = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Source.prototype));
  return [describe(built), built.method(), built.computed].join(" | ");
});

attempt("no source", () => describe(Object.defineProperties({}, Object.getOwnPropertyDescriptors(undefined))));
attempt("null as source", () => describe(Object.defineProperties({}, Object.getOwnPropertyDescriptors(null))));
attempt("a number as source", () => describe(Object.defineProperties({ a: 1 }, Object.getOwnPropertyDescriptors(1))));
attempt("no target", () => Object.defineProperties(undefined, Object.getOwnPropertyDescriptors({ a: 1 })));
attempt("a number as target", () => Object.defineProperties(1, Object.getOwnPropertyDescriptors({ a: 1 })));
attempt("neither: the source is asked first", () => Object.defineProperties(undefined, Object.getOwnPropertyDescriptors(undefined)));

attempt("the operands are evaluated from left to right", () => {
  const steps = [];
  const built = Object.defineProperties((steps.push("target"), { a: 1 }), Object.getOwnPropertyDescriptors((steps.push("source"), { b: 2 })));
  return steps.join() + " " + describe(built);
});

attempt("somebody else has the descriptors too", () => {
  const source = { a: 1, get b() { return 2; } };
  const descriptors = Object.getOwnPropertyDescriptors(source);
  const built = Object.defineProperties({}, descriptors);
  descriptors.a.value = "changed";
  delete descriptors.b;
  return [describe(built), describe(Object.defineProperties({}, descriptors)), Object.keys(descriptors).join()].join(" | ");
});

attempt("the descriptors are changed in between", () => {
  const descriptors = Object.getOwnPropertyDescriptors({ a: 1, b: 2 });
  descriptors.a.enumerable = false;
  descriptors.c = { value: 3 };
  return describe(Object.defineProperties({}, descriptors));
});

attempt("the source is changed between the two calls", () => {
  const source = { a: 1 };
  const change = () => {
    source.a = 2;
    source.b = 3;
    return {};
  };
  const descriptors = Object.getOwnPropertyDescriptors(source);
  return describe(Object.defineProperties(change(), descriptors));
});

attempt("through a function of the program", () => describe(copyOnto({ a: 1 }, { b: 2, get c() { return 3; } })));
attempt("many shapes through one call", () => {
  const sources = [{ a: 1 }, { b: 2, a: 3 }, { get c() { return 4; } }, { [tag]: 5 }, [6], Object.create({ inherited: 7 }, { own: { value: 8 } })];
  return sources.map(source => describe(copyOnto({ ...defaults }, source))).join(" / ");
});

attempt("then more is assigned", () => {
  const source = { name: "tool", get schema() { return 1; }, call() { return "called"; } };
  const facing = { run() { return source.call(); }, label: "facing" };
  const built = Object.assign(Object.defineProperties({ ...defaults, shown: () => source.name }, Object.getOwnPropertyDescriptors(source)), facing);
  return [describe(built), built.run(), built.schema, built.shown()].join(" | ");
});

console.log(lines.join("\n"));
