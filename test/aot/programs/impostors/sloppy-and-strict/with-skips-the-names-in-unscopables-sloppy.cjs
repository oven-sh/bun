console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

var written = {
  read: function (object) {
    var x = "the local x";
    var y = "the local y";
    with (object) {
      return [x, y];
    }
  },
  store: function (object) {
    var x = "the local x";
    with (object) {
      x = "stored";
    }
    return [x, object.x];
  },
  namesOfLists: function (object) {
    var keys = "the local keys";
    var values = "the local values";
    var concat = "the local concat";
    var flat = "the local flat";
    var at = "the local at";
    with (object) {
      return [typeof keys, typeof values, typeof concat, typeof flat, typeof at];
    }
  },
  call: function (object) {
    var x = function () {
      return "the local function";
    };
    with (object) {
      return x();
    }
  },
};

var texts = {
  read: "function (object) { var x = \"the local x\"; var y = \"the local y\"; with (object) { return [x, y]; } }",
  store: "function (object) { var x = \"the local x\"; with (object) { x = \"stored\"; } return [x, object.x]; }",
  namesOfLists: "function (object) { var keys = \"the local keys\"; var values = \"the local values\"; var concat = \"the local concat\"; var flat = \"the local flat\"; var at = \"the local at\"; with (object) { return [typeof keys, typeof values, typeof concat, typeof flat, typeof at]; } }",
  call: "function (object) { var x = function () { return \"the local function\"; }; with (object) { return x(); } }",
};

var ways = {
  "direct eval": function (text) {
    return eval("(" + text + ")");
  },
  "indirect eval": function (text) {
    return (0, eval)("(" + text + ")");
  },
  "new Function": function (text) {
    return new Function("return (" + text + ")")();
  },
};

var log = [];
var objects = {
  plain: () => ({ x: "the member x", y: "the member y" }),
  hidesX: () => ({ x: "the member x", y: "the member y", [Symbol.unscopables]: { x: true } }),
  hidesNothing: () => ({ x: "the member x", y: "the member y", [Symbol.unscopables]: { x: false, y: 0 } }),
  hidesByText: () => ({ x: "the member x", y: "the member y", [Symbol.unscopables]: { x: "yes", y: "" } }),
  unscopablesIsAText: () => ({ x: "the member x", y: "the member y", [Symbol.unscopables]: "x" }),
  inheritedUnscopables: () => Object.create({ [Symbol.unscopables]: { x: true } }, { x: { value: "the member x", writable: true }, y: { value: "the member y" } }),
  unscopablesInherits: () => ({ x: "the member x", y: "the member y", [Symbol.unscopables]: Object.create({ y: true }) }),
  getterForUnscopables: () => ({
    x: "the member x",
    y: "the member y",
    get [Symbol.unscopables]() {
      log.push("unscopables");
      return { x: log.length % 2 === 1 };
    },
  }),
  callable: () => ({
    x: function () {
      return this === undefined ? "undefined" : typeof this.x;
    },
  }),
  hiddenCallable: () => ({
    x: function () {
      return "the member function";
    },
    [Symbol.unscopables]: { x: true },
  }),
  list: () => [1, 2],
  heirOfAList: () => Object.create([1, 2]),
  listWithoutUnscopables: () => Object.defineProperty([1, 2], Symbol.unscopables, { value: undefined }),
};
function drive(label, callee) {
  for (var name in objects) {
    log.length = 0;
    attempt(label + "(" + name + ")", callee.bind(null, objects[name]()));
    if (log.length) console.log(label + "(" + name + ") read", log.join(", "));
  }
}

Object.keys(written).forEach(function (name) {
  drive("written " + name, written[name], name);
});
Object.keys(ways).forEach(function (way) {
  Object.keys(texts).forEach(function (name) {
    var made;
    try {
      made = ways[way](texts[name]);
    } catch (error) {
      console.log(way + " " + name, "is refused:", error.constructor.name);
      return;
    }
    drive(way + " " + name, made, name);
  });
});
