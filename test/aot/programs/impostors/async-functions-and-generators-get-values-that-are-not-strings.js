function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

async function lengthAfterAwait(promise) {
  const text = await promise;
  return text.length;
}

async function upperAfterAwait(promise) {
  return (await promise).toUpperCase();
}

async function usedBeforeAndAfter(text, pause) {
  const before = text.charCodeAt(0);
  await pause;
  return [before, text.charCodeAt(1), text.length];
}

async function joinAwaited(promises) {
  let text = "";
  for (const promise of promises) text += await promise;
  return text;
}

async function keyAfterAwait(table, promise) {
  return table[await promise];
}

function* upperOfWhatIsSent() {
  let sent = yield "ready";
  while (true) sent = yield sent.toUpperCase();
}

function* lengthsOfWhatIsSent() {
  let total = 0;
  while (true) {
    const sent = yield total;
    total += sent.length;
  }
}

function* charactersOf(text) {
  for (let i = 0; i < text.length; i++) yield text[i];
}

function* delegated(text) {
  yield* text;
}

async function* asyncCharacters(text) {
  for (const character of text) yield character;
}

async function collect(iterable) {
  const seen = [];
  for await (const value of iterable) seen.push(value);
  return seen;
}

async function attemptAsync(label, run) {
  let line;
  try {
    line = show(await run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

const values = [
  "'hello'",
  "new String('hello')",
  "['h', 'e']",
  "{ length: 2, toUpperCase() { return 'LOOK ALIKE'; }, charCodeAt(i) { return -i; }, toString() { return 'alike'; } }",
  "5",
  "null",
  "undefined",
  "Symbol('s')",
  "Buffer.from('he')",
  "{ then(resolve) { resolve('from a thenable'); } }",
  "{ then(resolve) { resolve(['from', 'a', 'thenable']); } }",
  "{ then: 5, length: 1 }",
  "Promise.resolve('from a promise')",
  "Promise.resolve(7)",
];

async function main() {
  for (let i = 0; i < 500; i++) {
    await lengthAfterAwait("hello");
    await upperAfterAwait(Promise.resolve("hello"));
    await usedBeforeAndAfter("hello", null);
    await joinAwaited(["a", Promise.resolve("b")]);
    await keyAfterAwait({ a: 1 }, "a");
  }
  const warm = upperOfWhatIsSent();
  warm.next();
  const warmLengths = lengthsOfWhatIsSent();
  warmLengths.next();
  for (let i = 0; i < 2000; i++) {
    warm.next("hello");
    warmLengths.next("hello");
    [...charactersOf("ab")];
    [...delegated("ab")];
  }

  for (const text of values) {
    await attemptAsync("length after await " + text, () => lengthAfterAwait(make(text)));
    await attemptAsync("upper after await " + text, () => upperAfterAwait(make(text)));
    await attemptAsync("used before and after " + text, () => usedBeforeAndAfter(make(text), null));
    await attemptAsync("joined " + text, () => joinAwaited(["<", make(text), ">"]));
    await attemptAsync("key " + text, () => keyAfterAwait({ hello: "by hello", 5: "by five", null: "by null", undefined: "by undefined", "h,e": "by a list", alike: "by the look-alike", "from a thenable": "by a thenable", 7: "by seven", "from a promise": "by a promise" }, make(text)));
    attempt("sent to a warm generator " + text, () => warm.next(make(text)).value);
    attempt("sent to a fresh generator " + text, () => {
      const fresh = upperOfWhatIsSent();
      fresh.next();
      return fresh.next(make(text)).value;
    });
    attempt("lengths sent " + text, () => {
      const fresh = lengthsOfWhatIsSent();
      fresh.next();
      fresh.next("ab");
      return fresh.next(make(text)).value;
    });
    attempt("characters of " + text, () => [...charactersOf(make(text))]);
    attempt("delegated " + text, () => [...delegated(make(text))]);
    await attemptAsync("async characters of " + text, () => collect(asyncCharacters(make(text))));
    await attemptAsync("for await over " + text, () => collect(make(text)));
  }
  attempt("the warm generator is finished by the first throw", () => warm.next("hello"));
}

await main();

console.log("bytes made in plain sight", Buffer.from("he").length);
