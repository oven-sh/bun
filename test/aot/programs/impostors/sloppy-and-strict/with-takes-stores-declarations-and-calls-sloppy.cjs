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
  store: function (object) {
    var x = "the local x";
    with (object) {
      x = "stored";
    }
    return [x, object.x];
  },
  declare: function (object) {
    with (object) {
      var x = "declared inside";
    }
    return [x, object.x];
  },
  declareALet: function (object) {
    with (object) {
      let x = "a let inside";
      x = "stored to the let";
    }
    return object.x;
  },
  increment: function (object) {
    var x = 1;
    with (object) {
      x++;
    }
    return [x, object.x];
  },
  push: function (object) {
    var x = [];
    with (object) {
      x.push(1);
    }
    return [x, object.x];
  },
  receiver: function (object) {
    function x() {
      return this === undefined ? "undefined" : this === globalThis ? "the global object" : this === object ? "the object" : typeof this;
    }
    with (object) {
      return x();
    }
  },
  undeclared: function (object) {
    with (object) {
      madeByAStoreInsideWith = 1;
    }
    var made = [typeof madeByAStoreInsideWith, object.madeByAStoreInsideWith];
    delete globalThis.madeByAStoreInsideWith;
    return made;
  },
  loopVariable: function (object) {
    with (object) {
      for (var x = 0; x < 3; x++);
    }
    return [x, object.x];
  },
  pattern: function (object) {
    var x = "the local x";
    with (object) {
      [x] = ["from a pattern"];
    }
    return [x, object.x];
  },
  addedMidway: function (object) {
    var x = "the local x";
    with (object) {
      var before = x;
      object.x = "added midway";
      return [before, x];
    }
  },
};

var texts = {
  store: "function (object) { var x = \"the local x\"; with (object) { x = \"stored\"; } return [x, object.x]; }",
  declare: "function (object) { with (object) { var x = \"declared inside\"; } return [x, object.x]; }",
  declareALet: "function (object) { with (object) { let x = \"a let inside\"; x = \"stored to the let\"; } return object.x; }",
  increment: "function (object) { var x = 1; with (object) { x++; } return [x, object.x]; }",
  push: "function (object) { var x = []; with (object) { x.push(1); } return [x, object.x]; }",
  receiver: "function (object) { function x() { return this === undefined ? \"undefined\" : this === globalThis ? \"the global object\" : this === object ? \"the object\" : typeof this; } with (object) { return x(); } }",
  undeclared: "function (object) { with (object) { madeByAStoreInsideWith = 1; } var made = [typeof madeByAStoreInsideWith, object.madeByAStoreInsideWith]; delete globalThis.madeByAStoreInsideWith; return made; }",
  loopVariable: "function (object) { with (object) { for (var x = 0; x < 3; x++); } return [x, object.x]; }",
  pattern: "function (object) { var x = \"the local x\"; with (object) { [x] = [\"from a pattern\"]; } return [x, object.x]; }",
  addedMidway: "function (object) { var x = \"the local x\"; with (object) { var before = x; object.x = \"added midway\"; return [before, x]; } }",
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

var objects = {
  empty: () => ({}),
  withX: () => ({ x: 10 }),
  withAList: () => ({ x: [0] }),
  frozen: () => Object.freeze({ x: 10 }),
  getterOnly: () => ({
    get x() {
      return 10;
    },
  }),
  withAMethod: () => ({
    x: function () {
      return this === undefined ? "undefined" : this === globalThis ? "the global object" : "x" in this ? "an object with x" : typeof this;
    },
  }),
  withTheUndeclaredName: () => ({ madeByAStoreInsideWith: 0 }),
};
function drive(label, callee) {
  for (var name in objects) attempt(label + "(" + name + ")", callee.bind(null, objects[name]()));
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
