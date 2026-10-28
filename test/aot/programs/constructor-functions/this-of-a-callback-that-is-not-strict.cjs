const seen = [];
function note(label, value) {
  seen.push(
    label +
      ":" +
      (value === globalThis
        ? "global"
        : value === null
          ? "null"
          : typeof value === "object"
            ? Object.prototype.toString.call(value)
            : typeof value),
  );
}
[1].forEach(function () {
  note("forEach", this);
});
[1].forEach(function () {
  note("forEach with this", this);
}, 5);
[1].map(function () {
  note("map", this);
});
[1].filter(function () {
  note("filter", this);
}, "text");
[2, 1].sort(function (a, b) {
  note("sort", this);
  return a - b;
});
[1].reduce(function (a) {
  note("reduce", this);
  return a;
}, 0);
Array.from([1], function () {
  note("Array.from", this);
});
Array.from(
  [1],
  function () {
    note("Array.from with this", this);
  },
  true,
);
"a".replace("a", function () {
  note("replace", this);
  return "b";
});
"a".replace(/a/, function () {
  note("replace by pattern", this);
  return "b";
});
new Map([[1, 2]]).forEach(function () {
  note("Map forEach", this);
});
new Set([1]).forEach(function () {
  note("Set forEach", this);
}, 1n);
JSON.parse('{"a":1}', function (key, value) {
  note("reviver " + key, this);
  return value;
});
JSON.stringify({ a: 1 }, function (key, value) {
  note("replacer " + key, this);
  return value;
});
JSON.stringify({
  toJSON: function () {
    note("toJSON", this);
    return 1;
  },
});
String({
  toString: function () {
    note("toString", this);
    return "";
  },
});
+{
  valueOf: function () {
    note("valueOf", this);
    return 1;
  },
};
`${{
  [Symbol.toPrimitive]: function () {
    note("toPrimitive", this);
    return "";
  },
}}`;
Object.defineProperty({}, "a", {
  get: function () {
    note("getter", this);
    return 1;
  },
}).a;
Object.defineProperty({}, "a", {
  set: function () {
    note("setter", this);
  },
}).a = 1;
Object.defineProperty(Number.prototype, "ofNumber", {
  get: function () {
    note("getter of a number", this);
    return 1;
  },
  configurable: true,
});
(5).ofNumber;
delete Number.prototype.ofNumber;
new Proxy(
  {},
  {
    get: function () {
      note("trap", this);
      return 1;
    },
  },
).a;
Reflect.apply(
  function () {
    note("Reflect.apply", this);
  },
  undefined,
  [],
);
Reflect.apply(
  function () {
    note("Reflect.apply of a symbol", this);
  },
  Symbol.iterator,
  [],
);
(function () {
  note("call", this);
}).call();
(function () {
  note("call of null", this);
}).call(null);
(function () {
  note("apply", this);
}).apply();
(function () {
  note("apply of a number", this);
}).apply(1, []);
(function () {
  note("bind", this);
}).bind()();
(function () {
  note("bind of text", this);
}).bind("text")();
(function () {
  note("plain", this);
})();
(0,
{
  m: function () {
    note("comma", this);
  },
}.m)();
(function (strings) {
  note("tag", this);
})`x`;
new (function Made() {
  note("new", this);
})();
Reflect.construct(function Made() {
  note("Reflect.construct", this);
}, []);
for (const x of {
  [Symbol.iterator]: function () {
    note("iterator", this);
    return {
      next: function () {
        note("next", this);
        return { done: true };
      },
    };
  },
});
new Promise(function (resolve) {
  note("executor", this);
  resolve(1);
}).then(function () {
  note("then", this);
  queueMicrotask(function () {
    note("queueMicrotask", this);
    process.nextTick(function () {
      note("nextTick", this);
      setTimeout(function () {
        note("setTimeout", this);
        const emitter = new (require("events"))();
        emitter.on("event", function () {
          note("listener", this === emitter ? {} : this);
        });
        emitter.emit("event");
        console.log(seen.join("\n"));
      }, 0);
    });
  });
});
