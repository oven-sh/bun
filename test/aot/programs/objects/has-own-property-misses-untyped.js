// hasOwnProperty asked with a string that is the name of no property anywhere, as Express asks its settings for "json escape": the answers, and that the run time is asked once and not every time.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const settings = { etag: "weak", env: "test", "query parser": "extended", "x-powered-by": true };
function get(settings, setting) {
  while (settings && settings !== Object.prototype) {
    if (hasOwnProperty.call(settings, setting))
      return settings[setting];
    settings = Object.getPrototypeOf(settings);
  }
  return undefined;
}
const seen = new Set();
let before = count("operationAOTHasOwnProperty");
for (let i = 0; i < 2000; i++)
  seen.add([get(settings, "json escape"), get(settings, "json replacer"), get(settings, "json spaces"), get(settings, "etag"), get(settings, "query parser")].join());
let calls = count("operationAOTHasOwnProperty") - before;
console.log([...seen].join(" | "), calls <= 40 ? "and the run time was asked at most 40 times" : "and the run time was asked " + calls + " times");

// Object.hasOwn likewise, and a name that is put together.
const parts = ["never", "a", "name"];
const others = new Set();
before = count("operationAOTHasOwnProperty");
const joined = parts.join(" ");
for (let i = 0; i < 2000; i++)
  others.add([Object.hasOwn(settings, "nobody has this"), Object.hasOwn(settings, joined), Object.hasOwn(settings, "env")].join());
calls = count("operationAOTHasOwnProperty") - before;
console.log([...others].join(" | "), calls <= 40 ? "and the run time was asked at most 40 times" : "and the run time was asked " + calls + " times");

// The answer changes with the object.
for (let i = 0; i < 6; i++) {
  const object = { first: 1 };
  const name = "added later " + (i & 1);
  const answers = [hasOwnProperty.call(object, "added later 0"), hasOwnProperty.call(object, name)];
  object[name] = i;
  answers.push(hasOwnProperty.call(object, "added later 0"), hasOwnProperty.call(object, name), hasOwnProperty.call(object, "added later 1"));
  delete object[name];
  answers.push(hasOwnProperty.call(object, name));
  console.log(answers.join());
}
const grows = {};
for (let i = 0; i < 4; i++) {
  console.log(hasOwnProperty.call(grows, "json escape"), hasOwnProperty.call(grows, "comes at two"));
  if (i === 1)
    grows["comes at two"] = true;
  if (i === 2)
    grows["json escape"] = false;
}

// Keys that are no plain names, and receivers that are no plain objects.
const keys = ["", "0", "12", "-0", "1.5", "__proto__", "length", "constructor", Symbol.iterator, 7, null, undefined, { toString() { return "etag"; } }];
const receivers = [settings, [1, 2, 3], "text", function named() {}, new Map(), Object.create(settings), Object.create(null), new Uint8Array(2), 5];
for (const receiver of receivers)
  console.log(keys.map((key) => hasOwnProperty.call(receiver, key) ? 1 : 0).join(""));
for (const receiver of [null, undefined]) {
  try { hasOwnProperty.call(receiver, "json escape"); console.log("no exception"); } catch (error) { console.log(error.constructor.name); }
}
