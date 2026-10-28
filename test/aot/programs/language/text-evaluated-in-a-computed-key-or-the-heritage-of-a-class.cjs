// Sloppy-mode functions hold classes whose computed keys and heritage run a direct eval. All parts of a class are strict code, so the text is too. Plain Bun prints another output.
function say(label, run) {
  let text;
  try {
    text = String(run());
  } catch (error) {
    text = error.name;
  }
  console.log(label + ": " + text);
}
for (const text of [
  "(arguments = 4, arguments)",
  "var arguments = 4; arguments",
  "with ({ a: 5 }) a",
  "var leaked = 1; typeof leaked",
  "(undeclaredOne = 1, typeof undeclaredOne)",
  "typeof this",
  "(function () { return typeof this; })()",
  "010",
]) {
  say("key of a field | " + text, () =>
    (function (a) {
      return Object.getOwnPropertyNames(
        new (class {
          [String(eval(text))] = 1;
        })(),
      ).join();
    })(1),
  );
  say("key of a method | " + text, () =>
    (function (a) {
      return Object.getOwnPropertyNames(
        class {
          [String(eval(text))]() {}
        }.prototype,
      ).join();
    })(1),
  );
  say("key of a static method | " + text, () =>
    (function (a) {
      return Object.getOwnPropertyNames(
        class {
          static [String(eval(text))]() {}
        },
      ).join();
    })(1),
  );
  say("key of a getter | " + text, () =>
    (function (a) {
      return Object.getOwnPropertyNames(
        class {
          get [String(eval(text))]() {
            return 1;
          }
        }.prototype,
      ).join();
    })(1),
  );
  say("heritage | " + text, () =>
    (function (a) {
      let seen;
      class C extends ((seen = eval(text)), Object) {}
      return seen;
    })(1),
  );
  say("key of an object literal | " + text, () =>
    (function (a) {
      return Object.getOwnPropertyNames({ [String(eval(text))]: 1 }).join();
    })(1),
  );
}
