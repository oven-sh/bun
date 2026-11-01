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
/* Output:
a rest parameter | var a = 4; a: [4, 4]
an object pattern | var a = 4; a: [4, 4]
an array pattern | var a = 4; a: [4, 4]
an object pattern declares the name | var a = 4; a: [4, 4]
an array pattern declares the name | var a = 4; a: [4, 4]
the rest parameter has the name | var a = 4; a: [4, 4]
an arrow function | var a = 4; a: [4, 4]
a method | var a = 4; a: [4, 4]
a generator | var a = 4; a: [4, 4]
a closure made ahead of the text | var a = 4; a: [4, 4]
the arguments object | var a = 4; a: [4, 4, 1]
a rest parameter | var a = 4; var a; a: [4, 4]
an object pattern | var a = 4; var a; a: [4, 4]
an array pattern | var a = 4; var a; a: [4, 4]
an object pattern declares the name | var a = 4; var a; a: [4, 4]
an array pattern declares the name | var a = 4; var a; a: [4, 4]
the rest parameter has the name | var a = 4; var a; a: [4, 4]
an arrow function | var a = 4; var a; a: [4, 4]
a method | var a = 4; var a; a: [4, 4]
a generator | var a = 4; var a; a: [4, 4]
a closure made ahead of the text | var a = 4; var a; a: [4, 4]
the arguments object | var a = 4; var a; a: [4, 4, 1]
a rest parameter | function a() {} typeof a: [function, function]
an object pattern | function a() {} typeof a: [function, function]
an array pattern | function a() {} typeof a: [function, function]
an object pattern declares the name | function a() {} typeof a: [function, function]
an array pattern declares the name | function a() {} typeof a: [function, function]
the rest parameter has the name | function a() {} typeof a: [function, function]
an arrow function | function a() {} typeof a: [function, function]
a method | function a() {} typeof a: [function, function]
a generator | function a() {} typeof a: [function, function]
a closure made ahead of the text | function a() {} typeof a: [function, function]
the arguments object | function a() {} typeof a: [function, function, 1]
a rest parameter | { var a = 4; } a: [4, 4]
an object pattern | { var a = 4; } a: [4, 4]
an array pattern | { var a = 4; } a: [4, 4]
an object pattern declares the name | { var a = 4; } a: [4, 4]
an array pattern declares the name | { var a = 4; } a: [4, 4]
the rest parameter has the name | { var a = 4; } a: [4, 4]
an arrow function | { var a = 4; } a: [4, 4]
a method | { var a = 4; } a: [4, 4]
a generator | { var a = 4; } a: [4, 4]
a closure made ahead of the text | { var a = 4; } a: [4, 4]
the arguments object | { var a = 4; } a: [4, 4, 1]
a rest parameter | for (var a = 4; false; ); a: [4, 4]
an object pattern | for (var a = 4; false; ); a: [4, 4]
an array pattern | for (var a = 4; false; ); a: [4, 4]
an object pattern declares the name | for (var a = 4; false; ); a: [4, 4]
an array pattern declares the name | for (var a = 4; false; ); a: [4, 4]
the rest parameter has the name | for (var a = 4; false; ); a: [4, 4]
an arrow function | for (var a = 4; false; ); a: [4, 4]
a method | for (var a = 4; false; ); a: [4, 4]
a generator | for (var a = 4; false; ); a: [4, 4]
a closure made ahead of the text | for (var a = 4; false; ); a: [4, 4]
the arguments object | for (var a = 4; false; ); a: [4, 4, 1]
*/
