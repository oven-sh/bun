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
/* Output:
key of a field | (arguments = 4, arguments): SyntaxError
key of a method | (arguments = 4, arguments): SyntaxError
key of a static method | (arguments = 4, arguments): SyntaxError
key of a getter | (arguments = 4, arguments): SyntaxError
heritage | (arguments = 4, arguments): SyntaxError
key of an object literal | (arguments = 4, arguments): 4
key of a field | var arguments = 4; arguments: SyntaxError
key of a method | var arguments = 4; arguments: SyntaxError
key of a static method | var arguments = 4; arguments: SyntaxError
key of a getter | var arguments = 4; arguments: SyntaxError
heritage | var arguments = 4; arguments: SyntaxError
key of an object literal | var arguments = 4; arguments: 4
key of a field | with ({ a: 5 }) a: SyntaxError
key of a method | with ({ a: 5 }) a: SyntaxError
key of a static method | with ({ a: 5 }) a: SyntaxError
key of a getter | with ({ a: 5 }) a: SyntaxError
heritage | with ({ a: 5 }) a: SyntaxError
key of an object literal | with ({ a: 5 }) a: 5
key of a field | var leaked = 1; typeof leaked: number
key of a method | var leaked = 1; typeof leaked: constructor,number
key of a static method | var leaked = 1; typeof leaked: length,name,prototype,number
key of a getter | var leaked = 1; typeof leaked: constructor,number
heritage | var leaked = 1; typeof leaked: number
key of an object literal | var leaked = 1; typeof leaked: number
key of a field | (undeclaredOne = 1, typeof undeclaredOne): ReferenceError
key of a method | (undeclaredOne = 1, typeof undeclaredOne): ReferenceError
key of a static method | (undeclaredOne = 1, typeof undeclaredOne): ReferenceError
key of a getter | (undeclaredOne = 1, typeof undeclaredOne): ReferenceError
heritage | (undeclaredOne = 1, typeof undeclaredOne): ReferenceError
key of an object literal | (undeclaredOne = 1, typeof undeclaredOne): number
key of a field | typeof this: object
key of a method | typeof this: constructor,object
key of a static method | typeof this: length,name,prototype,object
key of a getter | typeof this: constructor,object
heritage | typeof this: object
key of an object literal | typeof this: object
key of a field | (function () { return typeof this; })(): undefined
key of a method | (function () { return typeof this; })(): constructor,undefined
key of a static method | (function () { return typeof this; })(): length,name,prototype,undefined
key of a getter | (function () { return typeof this; })(): constructor,undefined
heritage | (function () { return typeof this; })(): undefined
key of an object literal | (function () { return typeof this; })(): object
key of a field | 010: SyntaxError
key of a method | 010: SyntaxError
key of a static method | 010: SyntaxError
key of a getter | 010: SyntaxError
heritage | 010: SyntaxError
key of an object literal | 010: 8
*/
