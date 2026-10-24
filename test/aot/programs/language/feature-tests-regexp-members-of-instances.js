// Feature tests that polyfills (core-js, es6-shim) run when they load: an own `exec` on a regular expression, an object with a method under Symbol.match, replace, search or split, `re[Symbol.match] = false`, and the generic getters and methods of RegExp.prototype on plain objects. RegExp.prototype and String.prototype are only read. Each answers as in plain Bun.
function attempt(label, run) {
  try { console.log(label + ": " + String(run())); } catch (error) { console.log(label + ": " + error.constructor.name); }
}

attempt("test calls an own exec", () => {
  let called = false;
  const re = /[ac]/;
  re.exec = function () { called = true; return /./.exec.apply(this, arguments); };
  return [re.test("abc"), called].join();
});
for (const name of ["match", "replace", "search", "split"]) {
  attempt("''." + name + " calls the method under Symbol." + name, () => {
    const object = {};
    object[Symbol[name]] = function () { return 7; };
    return ""[name](object);
  });
  attempt("the method under Symbol." + name + " calls an own exec", () => {
    let called = false;
    let re = /a/;
    if (name === "split") {
      const constructor = {};
      constructor[Symbol.species] = function () { return re; };
      re = { constructor, flags: "" };
      re[Symbol.split] = /./[Symbol.split];
    }
    re.exec = function () { called = true; return null; };
    re[Symbol[name]]("");
    return called;
  });
}
attempt("'a'.match of an object with Symbol.match", () => { const object = {}; object[Symbol.match] = function () { return 42; }; return "a".match(object); });
attempt("replace reads the groups an own exec gives", () => {
  const re = /./;
  re.exec = function () { const result = []; result.groups = { a: "7" }; return result; };
  return "".replace(re, "$<a>");
});
attempt("split with an own exec that calls the original", () => {
  const re = /(?:)/;
  const original = re.exec;
  re.exec = function () { return original.apply(this, arguments); };
  return "ab".split(re).join("|");
});
attempt("matchAll and replaceAll with an own exec", () => {
  let calls = 0;
  const re = /b/g;
  const original = re.exec;
  re.exec = function () { calls++; return original.apply(this, arguments); };
  return ["abcb".replaceAll(re, "-"), calls].join();
});

attempt("RegExp(re) with Symbol.match set to false", () => {
  const first = /a/g;
  const second = /a/g;
  second[Symbol.match] = false;
  return [RegExp(first) === first, RegExp(second) === second, String(RegExp(first, "i"))].join();
});
for (const name of ["includes", "startsWith", "endsWith"]) {
  attempt(name + " refuses a regular expression", () => "/./"[name](/./));
  attempt(name + " takes one whose Symbol.match is false", () => { const re = /./; re[Symbol.match] = false; return "/./"[name](re); });
  attempt(name + " refuses an object whose Symbol.match is true", () => "[object Object]"[name]({ [Symbol.match]: true }));
}

attempt("the getter of flags on a plain object", () => {
  const object = {};
  let calls = "";
  const pairs = { dotAll: "s", global: "g", ignoreCase: "i", multiline: "m", sticky: "y", hasIndices: "d" };
  for (const key in pairs) Object.defineProperty(object, key, { get() { calls += pairs[key]; return true; } });
  return [Object.getOwnPropertyDescriptor(RegExp.prototype, "flags").get.call(object), calls].join();
});
attempt("toString on a plain object", () => RegExp.prototype.toString.call({ source: "a", flags: "b" }));
attempt("toString reads own source and flags of a regular expression", () => {
  const re = /a/g;
  Object.defineProperty(re, "source", { value: "other" });
  Object.defineProperty(re, "flags", { value: "y" });
  return String(re);
});
attempt("the name of toString", () => RegExp.prototype.toString.name);
