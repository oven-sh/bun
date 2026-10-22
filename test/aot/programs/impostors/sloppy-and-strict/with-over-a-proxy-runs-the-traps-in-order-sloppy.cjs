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
    with (object) {
      return x;
    }
  },
  store: function (object) {
    var x = "the local x";
    with (object) {
      x = "stored";
    }
    return x;
  },
  addTo: function (object) {
    var x = 1;
    with (object) {
      x += 1;
    }
    return x;
  },
  call: function (object) {
    var x = function () {
      return "the local function";
    };
    with (object) {
      return x();
    }
  },
  kind: function (object) {
    with (object) {
      return typeof neverDeclared;
    }
  },
  remove: function (object) {
    var x = 1;
    with (object) {
      return delete x;
    }
  },
  vanishes: function (object) {
    var x = "the local x";
    with (object) {
      x = (delete object.target.x, "stored after the member vanished");
    }
    return [x, object.target.x];
  },
};

var texts = {
  read: "function (object) { var x = \"the local x\"; with (object) { return x; } }",
  store: "function (object) { var x = \"the local x\"; with (object) { x = \"stored\"; } return x; }",
  addTo: "function (object) { var x = 1; with (object) { x += 1; } return x; }",
  call: "function (object) { var x = function () { return \"the local function\"; }; with (object) { return x(); } }",
  kind: "function (object) { with (object) { return typeof neverDeclared; } }",
  remove: "function (object) { var x = 1; with (object) { return delete x; } }",
  vanishes: "function (object) { var x = \"the local x\"; with (object) { x = (delete object.target.x, \"stored after the member vanished\"); } return [x, object.target.x]; }",
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
function logging(target, has) {
  return new Proxy(target, {
    has: function (target, key) {
      log.push("has " + String(key));
      return has === undefined ? Reflect.has(target, key) : has;
    },
    get: function (target, key, receiver) {
      log.push("get " + String(key));
      return key === "target" ? target : Reflect.get(target, key, receiver);
    },
    set: function (target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    deleteProperty: function (target, key) {
      log.push("delete " + String(key));
      return Reflect.deleteProperty(target, key);
    },
    getOwnPropertyDescriptor: function (target, key) {
      log.push("describe " + String(key));
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    defineProperty: function (target, key, property) {
      log.push("define " + String(key));
      return Reflect.defineProperty(target, key, property);
    },
  });
}
var objects = {
  empty: () => logging({}),
  withX: () => logging({ x: 5 }),
  withAFunction: () =>
    logging({
      x: function () {
        return "the member function";
      },
    }),
  claimsEverything: () => logging({}, true),
  claimsNothing: () => logging({ x: 5 }, false),
  hidesX: () => logging({ x: 5, [Symbol.unscopables]: { x: true } }),
};
function drive(label, callee) {
  for (var name in objects) {
    log.length = 0;
    attempt(label + "(" + name + ")", callee.bind(null, objects[name]()));
    console.log(label + "(" + name + ") ran", log.join(", "));
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
