// Prints the frames of errors that built-in functions make: called in a tail call, by a constructor, a getter, call, apply and bind, below callbacks of other built-in functions, under limits of the stack trace.
function framesOf(error) {
  return String(error.stack)
    .split("\n")
    .map(text =>
      /^\s*at (.*?) ?\(?(?:[^ ()]*frames-errors-builtin-functions-compiled\.mjs:(\d+):(\d+)|native|unknown)\)?$/.exec(
        text,
      ),
    )
    .filter(found => found !== null)
    .map(found => (found[2] ? found[1] + "@" + found[2] + ":" + found[3] : found[1]))
    .join(" < ");
}
function show(name, run) {
  try {
    run();
    console.log(name, "| nothing thrown");
  } catch (error) {
    console.log(name, "|", error.constructor.name, "|", framesOf(error));
  }
}
function parse(text) {
  return JSON.parse(text);
}
function parseAndKeep(text) {
  const value = JSON.parse(text);
  return value;
}
function outer(text) {
  const value = parseAndKeep(text);
  return value;
}
class Holder {
  constructor(text) {
    this.value = JSON.parse(text);
  }
  get parsed() {
    const value = JSON.parse("{");
    return value;
  }
  static make(text) {
    const made = new Holder(text);
    return made;
  }
}
function deep(n, text) {
  if (n === 0) return parseAndKeep(text);
  const value = deep(n - 1, text);
  return value;
}
show("tail call", () => parse("{"));
show("kept", () => parseAndKeep("{"));
show("two frames", () => outer("{"));
show("constructor", () => new Holder("{"));
show("static", () => Holder.make("{"));
show("getter", () => new Holder("1").parsed);
show("deep", () => deep(30, "{"));
show("repeat", () => {
  const s = "abc".repeat(-1);
  return s;
});
show("decode", () => {
  const s = decodeURIComponent("%");
  return s;
});
show("bigint", () => {
  const b = BigInt(1.5);
  return b;
});
show("call", () => {
  const v = JSON.parse.call(null, "{");
  return v;
});
show("apply", () => {
  const v = JSON.parse.apply(null, ["{"]);
  return v;
});
show("bound", () => {
  const v = JSON.parse.bind(null, "{")();
  return v;
});
show("reflect", () => {
  const v = Reflect.apply(JSON.parse, null, ["{"]);
  return v;
});
show("native getter", () => {
  const v = Object.getOwnPropertyDescriptor(Map.prototype, "size").get.call({});
  return v;
});
show("map method", () => {
  const v = Map.prototype.get.call({}, 1);
  return v;
});
show("callback", () => {
  const v = [1].map(function each() {
    const w = JSON.parse("{");
    return w;
  });
  return v;
});
show("sort callback", () => {
  const v = [2, 1].sort(function compare() {
    const w = JSON.parse("{");
    return w;
  });
  return v;
});
show("replace callback", () => {
  const v = "a".replace(/a/, function replacer() {
    const w = JSON.parse("{");
    return w;
  });
  return v;
});
show("proxy", () => {
  const v = new Proxy(
    {},
    {
      get() {
        const w = JSON.parse("{");
        return w;
      },
    },
  ).x;
  return v;
});
show("toString", () => {
  const v = `${{
    toString() {
      const w = JSON.parse("{");
      return w;
    },
  }}`;
  return v;
});
show("reviver", () => {
  const v = JSON.parse("[1]", function revive() {
    const w = JSON.parse("{");
    return w;
  });
  return v;
});
show("toJSON", () => {
  const v = JSON.stringify({
    toJSON() {
      const w = JSON.parse("{");
      return w;
    },
  });
  return v;
});
show("url", () => {
  const v = new URL("::");
  return v;
});
show("regexp", () => {
  const v = new RegExp("(");
  return v;
});
show("array length", () => {
  const v = new Array(-1);
  return v;
});
show("intl", () => {
  const v = new Intl.NumberFormat("x-invalid-");
  return v;
});
show("normalize", () => {
  const v = "a".normalize("x");
  return v;
});
show("toFixed", () => {
  const v = (1).toFixed(1000);
  return v;
});
show("define", () => {
  const v = Object.defineProperty(Object.freeze({}), "a", { value: 1 });
  return v;
});
show("set prototype", () => {
  const v = Object.setPrototypeOf(Object.preventExtensions({}), {});
  return v;
});
for (const limit of [0, 1, 2, 3, 100]) {
  Error.stackTraceLimit = limit;
  show("limit " + limit, () => outer("{"));
}
Error.stackTraceLimit = 10;
function* steps() {
  const value = JSON.parse("{");
  yield value;
}
show("generator", () => {
  for (const v of steps()) console.log(v);
});
async function later() {
  await null;
  const value = JSON.parse("{");
  return value;
}
async function awaits() {
  const value = await later();
  return value;
}
awaits().catch(error => console.log("async |", framesOf(error)));
