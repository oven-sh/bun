const log = [];

function reached(name) {
  log.push(name);
  return name.length;
}

async function attempt(label, run) {
  log.length = 0;
  let outcome;
  try {
    outcome = String(await run());
  } catch (error) {
    outcome = "threw " + error.constructor.name;
  }
  console.log(label + ":", outcome, "| reached", log.join() || "nothing");
}

const key = text => JSON.parse(JSON.stringify(text));

const table = {
  byComputedName() {
    return reached("byComputedName");
  },
  byJoinedName() {
    return reached("byJoinedName");
  },
};

function byReflectApply() {
  return reached("byReflectApply");
}
function byCallOfCall() {
  return reached("byCallOfCall");
}
function byBind() {
  return reached("byBind");
}
function ByReflectConstruct() {
  this.size = reached("ByReflectConstruct");
}
function byListOfFunctions() {
  return reached("byListOfFunctions");
}
function byGlobalName() {
  return reached("byGlobalName");
}
function byDescriptorGetter() {
  return reached("byDescriptorGetter");
}
function byDescriptorSetter(value) {
  reached("byDescriptorSetter" + value);
}
function byArguments() {
  return arguments[0]();
}
function handedInArguments() {
  return reached("handedInArguments");
}

await attempt("a member under a computed name", () => table[key("byComputedName")]());
await attempt("a member under a joined name", () => table["by" + key("Joined") + "Name"]());
await attempt("Reflect.apply", () => Reflect.apply(byReflectApply, undefined, []));
await attempt("call of call", () => Function.prototype.call.call(byCallOfCall));
await attempt("bind", () => byBind.bind(null)());
await attempt("Reflect.construct", () => Reflect.construct(ByReflectConstruct, []).size);
await attempt("an element of a list under a computed index", () => [byListOfFunctions][key(0)]());
globalThis[key("nameOnTheGlobalObject")] = byGlobalName;
await attempt("a property of the global object", () => globalThis.nameOnTheGlobalObject());
await attempt(
  "a getter from a descriptor",
  () => Object.defineProperty({}, key("got"), { get: byDescriptorGetter }).got,
);
await attempt("a setter from a descriptor", () => {
  Object.defineProperty({}, key("set"), { set: byDescriptorSetter }).set = 1;
});
await attempt("an element of arguments", () => byArguments(handedInArguments));

await attempt("valueOf under -", () => ({ valueOf: () => reached("valueOf") }) - 1);
await attempt("toString under a template", () => `${{ toString: () => "s" + reached("toString") }}`);
await attempt(
  "Symbol.toPrimitive under +",
  () => ({ [Symbol.toPrimitive]: hint => reached("toPrimitive " + hint) }) + 1,
);
await attempt("toString of a key", () => ({ k8: 1 })[{ toString: () => "k" + reached("keyToString".slice(0, 8)) }]);
await attempt("toJSON", () => JSON.stringify({ toJSON: () => reached("toJSON") }));
await attempt("a replacer", () => JSON.stringify({ a: 1 }, (name, value) => (name ? reached("replacer") : value)));
await attempt("a reviver", () => JSON.parse("[1]", (name, value) => (name ? reached("reviver") : value)));
await attempt("then under await", async () => await { then: resolve => resolve(reached("then")) });
await attempt(
  "Symbol.iterator under a spread",
  () =>
    [
      ...{
        [Symbol.iterator]: () => ({ next: () => ({ done: true, value: reached("next") }) }),
      },
    ].length,
);
await attempt("return of an iterator under break", () => {
  for (const value of {
    [Symbol.iterator]: () => ({
      next: () => ({ done: false, value: 1 }),
      return: () => ({ done: true, value: reached("return") }),
    }),
  })
    break;
});
await attempt("Symbol.asyncIterator under for await", async () => {
  for await (const value of {
    [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: reached("asyncNext") }) }),
  });
});
await attempt("Symbol.hasInstance", () => 1 instanceof { [Symbol.hasInstance]: () => reached("hasInstance") });
await attempt("Symbol.species", () => {
  class Listed extends Array {
    static get [Symbol.species]() {
      reached("species");
      return Array;
    }
  }
  return new Listed(1, 2).map(value => value).length;
});
await attempt("Symbol.replace", () => "a".replace({ [Symbol.replace]: () => reached("replace") }, ""));
await attempt("Symbol.split", () => "a".split({ [Symbol.split]: () => reached("split") }));
await attempt(
  "Symbol.isConcatSpreadable",
  () =>
    [].concat({
      get [Symbol.isConcatSpreadable]() {
        return reached("spreadable") > 0;
      },
      length: 0,
    }).length,
);
await attempt("Symbol.toStringTag", () =>
  Object.prototype.toString.call({
    get [Symbol.toStringTag]() {
      return "T" + reached("tag");
    },
  }),
);

const traps = {};
for (const trap of [
  "get",
  "set",
  "has",
  "deleteProperty",
  "ownKeys",
  "getOwnPropertyDescriptor",
  "defineProperty",
  "getPrototypeOf",
  "setPrototypeOf",
  "isExtensible",
  "preventExtensions",
  "apply",
  "construct",
]) {
  traps[trap] = (...list) => {
    reached(trap);
    return Reflect[trap](...list);
  };
}
await attempt("every trap of a proxy", () => {
  const proxy = new Proxy(function () {}, traps);
  proxy.a = 1;
  proxy.a;
  "a" in proxy;
  delete proxy.a;
  Object.keys(proxy);
  Object.getPrototypeOf(proxy);
  Object.setPrototypeOf(proxy, null);
  Object.isExtensible(proxy);
  proxy();
  new proxy();
  Object.preventExtensions(proxy);
});

await attempt("a comparator", () => [2, 1].sort((a, b) => reached("compare") && a - b));
await attempt("a callback of replace", () => "ab".replace(/a/, () => reached("replaced")));
await attempt("a mapper of Array.from", () => Array.from({ length: 1 }, () => reached("mapped")));
await attempt("a callback of a Map", () => new Map([[1, 2]]).forEach(() => reached("mapEach")));
await attempt("a reaction", () => Promise.resolve().then(() => reached("reaction")));
await attempt("a finally reaction", () => Promise.resolve(1).finally(() => reached("finally")));
await attempt("an executor", () => new Promise(resolve => resolve(reached("executor"))));
await attempt("a microtask", () => new Promise(resolve => queueMicrotask(() => resolve(reached("microtask")))));
await attempt("a timer", () => new Promise(resolve => setTimeout(() => resolve(reached("timer")), 0)));
await attempt("a tag of a template", () => (strings => reached("tag" + strings.length))`x`);
await attempt("a default of a parameter", () => ((value = reached("default")) => value)());
await attempt("a computed key of a class", () =>
  Object.keys(
    new (class {
      [reached("classKey")] = 1;
    })(),
  ),
);
await attempt("a static block", () => {
  class WithBlock {
    static size;
    static {
      WithBlock.size = reached("staticBlock");
    }
  }
  return WithBlock.size;
});
await attempt(
  "a field initializer",
  () =>
    new (class {
      size = reached("initializer");
    })().size,
);
await attempt("a getter on the prototype chain of a primitive", () => {
  Object.defineProperty(Number.prototype, key("reachedFromNumber"), {
    get: () => reached("numberGetter"),
    configurable: true,
  });
  const outcome = (5).reachedFromNumber;
  delete Number.prototype.reachedFromNumber;
  return outcome;
});
await attempt(
  "structuredClone runs getters",
  () =>
    structuredClone({
      get cloned() {
        return reached("clonedGetter");
      },
    }).cloned,
);
await attempt("Object.assign runs getters and setters", () => {
  Object.assign(
    {
      set moved(value) {
        reached("assignSetter");
      },
    },
    {
      get moved() {
        return reached("assignGetter");
      },
    },
  );
});
await attempt(
  "a spread runs getters",
  () =>
    ({
      ...{
        get spread() {
          return reached("spreadGetter");
        },
      },
    }).spread,
);
await attempt("a finalizer of using", () => {
  {
    using held = { [Symbol.dispose]: () => reached("dispose") };
  }
});
