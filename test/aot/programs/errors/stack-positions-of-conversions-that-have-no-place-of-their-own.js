// Prints where a stack trace places the frame that converts an object to a primitive value for `==`, a template literal, a concatenation and a compound assignment.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("thrown");
}
const holder = { text: "text", number: 5 };
let five = 5;
const key = "number";
const mark = Symbol("mark");
const inThisFile = /stack-positions-of-conversions/;
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    const places = String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
    console.log(label, "|", error.constructor.name, "|", places.slice(0, -2).join(" "));
  }
}
show("equal to a literal with a name", () => { pass(1 == { valueOf: fail }); });
show("a literal with a name equal to", () => { pass({ valueOf: fail } == 1); });
show("equal to a literal with a method", () => { pass(five == { valueOf() { fail(); } }); });
show("equal alone in the function", () => { 1 == { valueOf() { fail(); } }; });
show("equal behind a read", () => { pass(holder.text == { valueOf() { fail(); } }); });
show("equal behind a call", () => { pass(pass(1) == { valueOf() { fail(); } }); });
show("equal behind a sum", () => { pass(five + 1 == { valueOf() { fail(); } }); });
show("equal behind typeof", () => { pass(typeof five == { valueOf() { fail(); } }); });
show("equal behind a chain", () => { pass((five && holder.text) == { valueOf() { fail(); } }); });
show("equal with a name on the right", () => { pass({ valueOf() { fail(); } } == five); });
show("equal in a condition", () => { if (five == { valueOf() { fail(); } }) pass(1); });
show("equal in a loop's condition", () => { while (five == { valueOf() { fail(); } }) {} });
show("equal in a choice", () => { pass(five == { valueOf() { fail(); } } ? 1 : 2); });
show("not equal", () => { pass(1 != { valueOf: fail }); });
show("template with a method", () => { pass(`${{ toString() { fail(); } }}`); });
show("template with a name", () => { pass(`${{ toString: fail }}`); });
show("template behind a read", () => { pass(`${holder.text}${{ toString: fail }}x`); });
show("template behind a name", () => { pass(`${five}${{ toString() { fail(); } }}`); });
show("template behind a call", () => { pass(`${pass(1)}${{ toString() { fail(); } }}`); });
show("template alone in the function", () => { `${{ toString() { fail(); } }}`; });
show("template as initializer", () => { const text = `${{ toString() { fail(); } }}`; });
show("template returned", () => { return `${{ toString() { fail(); } }}`; });
show("template of a list", () => { pass(`${[{ toString: fail }]}`); });
show("template of a symbol", () => { pass(`a${holder.text}b${mark}`); });
show("concatenation ends in a literal", () => { pass("s" + five + { toString: fail }); });
show("concatenation around a literal", () => { pass("s" + { toString: fail } + five); });
show("concatenation around a method", () => { pass("s" + { toString() { fail(); } } + holder.text); });
show("concatenation behind a read", () => { pass("s" + holder.text + { toString() { fail(); } }); });
show("concatenation starts with a literal", () => { pass({ toString: fail } + "s" + holder.text); });
show("concatenation starts with a method", () => { pass({ toString() { fail(); } } + "s" + "t"); });
show("concatenation with a template", () => { pass(holder.text + "a" + `b${{ toString: fail }}`); });
show("concatenation with texts behind", () => { pass(five + "a" + { toString() { fail(); } } + "b" + "c"); });
show("concatenation with a symbol", () => { pass(holder.text + "a" + mark); });
show("text grows by a sum", () => { let text = "s"; text += "a" + { toString: fail }; });
show("text grows by a method", () => { let text = "s"; text += { toString() { fail(); } }; });
show("local grows by a name", () => { let count = 1; count += { valueOf: fail }; });
show("local shrinks by a method", () => { let count = 1; count -= { valueOf() { fail(); } }; });
show("local behind a call", () => { let count = 1; pass(2); count *= { valueOf() { fail(); } }; });
show("big local grows by a number", () => { let count = 1n; count += 1; });
show("symbol in a local", () => { let count = mark; pass(1); count -= 1; });
show("captured local", () => { let count = 1; const read = () => count; count += { valueOf() { fail(); } }; return read; });
show("variable of the file", () => { five += { valueOf() { fail(); } }; });
show("member grows by a method", () => { holder.number += { valueOf() { fail(); } }; });
show("member shrinks by a name", () => { holder.number -= { valueOf: fail }; });
show("element grows by a method", () => { holder[key] += { valueOf() { fail(); } }; });
show("over lines", () => {
  pass(
    five
      == {
        valueOf() {
          fail();
        },
      },
  );
});
