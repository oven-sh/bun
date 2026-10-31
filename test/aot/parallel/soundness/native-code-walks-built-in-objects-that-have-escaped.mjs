// `hook` is a value nobody knows, and undefined when the program runs. What goes through show() has escaped and is still listed where it comes back.
const hook = globalThis[process.argv[9] ?? "noSuchHook"];
function show(it) {
  hook?.(it);
  return it;
}
function* count() {
  yield 1;
  yield 2;
}
const tried = (title, act) => {
  let answer;
  try {
    answer = act();
  } catch (error) {
    answer = error.name + ": " + error.message;
  }
  console.log(title, typeof answer === "string" ? answer : JSON.stringify(answer));
};

tried("date", () => `${show(new Date(0)).toISOString()} ${show(new Date(0)) - 1} ${typeof (show(new Date(0)) + 1)}`);
tried("regexp", () => "" + show(/a+/gi));
tried("error", () => "" + show(new RangeError("far")));
tried("symbol object", () => String(show(Object(Symbol("s"))).description));
tried("bigint object", () => show(Object(10n)) + 1n + "");
tried("number object", () => show(new Number(4)) * 2);
tried("boolean object", () => `${show(new Boolean(false))}`);
tried("string object", () => show(new String("ab")) + "c");
tried("array", () => "" + show([1, [2, 3]]));
tried("typed array", () => "" + show(new Uint8Array([1, 2])));
tried("function", () => ("" + show(function named() {})).slice(0, 14));
tried("url", () => "" + show(new URL("http://a.example/b")));
tried("locale", () => "" + show(new Intl.Locale("en-US")));
tried("global", () => show(new WebAssembly.Global({ value: "i32" }, 5)) + 1);

tried("map", () => Array.from(show(new Map([[1, 2]]))));
tried("set", () => Array.from(show(new Set([3]))));
tried("map entries", () => Array.from(show(new Map([[1, 2]]).entries())));
tried("set values", () => Array.from(show(new Set([3]).values())));
tried("array values", () => Array.from(show([4, 5].values())));
tried("string", () => Array.from(show(new String("xy"))));
tried("string iterator", () => Array.from(show("xy"[Symbol.iterator]())));
tried("typed array values", () => Array.from(show(new Uint8Array([6]).values())));
tried("generator", () => Array.from(show(count())));
tried("matchAll", () => Array.from(show("aXbX".matchAll(/X/g)), match => match.index));
tried("segments", () => Array.from(show(new Intl.Segmenter("en").segment("ab")), part => part.segment));
tried("helper", () => Array.from(show([1, 2, 3].values().map(value => value * 2))));
tried("wrapped", () => {
  let left = 2;
  return Array.from(show(Iterator.from({ next: () => ({ done: !left, value: left-- }) })));
});
tried("new Map", () => [...new Map(show(new Map([[7, 8]])))]);
tried("new Set", () => [...new Set(show(new Set([9]).values()))]);
tried("fromEntries", () => Object.fromEntries(show(new Map([["k", 1]]))));
tried("own iterator", () => Array.from(show({ [Symbol.iterator]: count })));
tried("closed early", () => {
  const steps = [];
  const it = show({ [Symbol.iterator]() { return this; }, next: () => ({ done: false, value: 1 }), return() { steps.push("return"); return {}; } });
  try {
    new Map(it);
  } catch (error) {
    steps.push(error.name);
  }
  return steps;
});

tried("json date", () => JSON.stringify(show({ at: new Date(0) })));
tried("json own", () => JSON.stringify(show({ toJSON: () => "mine" })));
tried("json url", () => JSON.stringify(show({ at: new URL("http://a.example/") })));

// Read back out of a holder that has escaped: the value nobody knows stands beside each.
const box = show({ date: new Date(0), map: new Map([[1, 2]]), steps: [1, 2].values(), pattern: /b/ });
tried("boxed", () => [`${box.date.getTime()}`, Array.from(box.map), Array.from(box.steps), "" + box.pattern, box.date + 1 === new Date(0) + 1]);

// The link above an object that has escaped is written through a value that flow does not follow.
const above = [Map.prototype, Date.prototype, Array.prototype, RegExp.prototype][Number(process.argv[8] ?? 2)];
tried("below another prototype", () => "" + Object.setPrototypeOf(show({ length: 0 }), above));

console.log("thenable", await show({ then: resolve => resolve("then") }));
console.log("promise", await show(Promise.resolve("settled")));
console.log("all", JSON.stringify(await Promise.all(show(new Set([1, Promise.resolve(2)])))));
for await (const value of show((async function* () { yield "async"; })())) console.log("for await", value);
