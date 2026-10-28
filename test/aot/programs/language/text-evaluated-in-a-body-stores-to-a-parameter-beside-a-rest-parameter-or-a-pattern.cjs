// A sloppy-mode function has a rest parameter or a pattern among its parameters, and no default and no computed key. `var a = 4` in text that its body evaluates names the parameter `a`, so the body reads 4 from then on. Under `bun run` the text has a variable of its own and the body still reads the parameter.
function show(value) {
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return typeof value === "function" ? "function" : String(value);
}
function say(label, run) {
  let text;
  try {
    text = show(run());
  } catch (error) {
    text = error.name;
  }
  console.log(label + ": " + text);
}

for (const text of [
  "var a = 4; a",
  "var a = 4; var a; a",
  "function a() {} typeof a",
  "{ var a = 4; } a",
  "for (var a = 4; false; ); a",
]) {
  say("a rest parameter | " + text, () =>
    (function (a, ...b) {
      return [eval(text), a];
    })(1),
  );
  say("an object pattern | " + text, () =>
    (function (a, { b }) {
      return [eval(text), a];
    })(1, {}),
  );
  say("an array pattern | " + text, () =>
    (function (a, [b]) {
      return [eval(text), a];
    })(1, []),
  );
  say("an object pattern declares the name | " + text, () =>
    (function ({ a }) {
      return [eval(text), a];
    })({ a: 1 }),
  );
  say("an array pattern declares the name | " + text, () =>
    (function ([a], b) {
      return [eval(text), a];
    })([1]),
  );
  say("the rest parameter has the name | " + text, () =>
    (function (...a) {
      return [eval(text), a];
    })(1),
  );
  say("an arrow function | " + text, () => ((a, ...b) => [eval(text), a])(1));
  say("a method | " + text, () =>
    ({
      method(a, ...b) {
        return [eval(text), a];
      },
    }).method(1),
  );
  say("a generator | " + text, () => [
    ...(function* (a, ...b) {
      yield eval(text);
      yield a;
    })(1),
  ]);
  say("a closure made ahead of the text | " + text, () =>
    (function (a, ...b) {
      const read = () => a;
      return [eval(text), read()];
    })(1),
  );
  say("the arguments object | " + text, () =>
    (function (a, ...b) {
      return [eval(text), a, arguments[0]];
    })(1),
  );
}
