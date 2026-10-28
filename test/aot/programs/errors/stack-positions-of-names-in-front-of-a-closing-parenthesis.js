// Prints where a stack trace places a name that is read too early and is the last token in front of the `)` of a call or the `]` of a list.
function pass(value) {
  return value;
}
function Made() {}
const nothing = null;
const holder = { text: "text" };
let five = 5;
const inThisFile = /stack-positions-of-names-in-front/;
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    const places = String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
    console.log(label, "|", error.constructor.name, "|", places.slice(0, -2).join(" "));
  }
}
show("argument", () => { pass(late); let late = 1; });
show("stored to a name", () => { let name; pass(name = late); let late = 1; });
show("stored to a member", () => { pass(holder.text = late); let late = 1; });
show("stored twice", () => { let name, other; pass(name = other = late); let late = 1; });
show("stored, second argument", () => { let name; pass(1, name = late); let late = 1; });
show("stored, first argument", () => { let name; pass(name = late, 1); let late = 1; });
show("stored in parentheses", () => { let name; pass((name = late)); let late = 1; });
show("a name in parentheses is stored", () => { let name; pass(name = (late)); let late = 1; });
show("stored in a sum", () => { let name; pass(1 + (name = late)); let late = 1; });
show("stored under a minus", () => { let name; pass(-(name = late)); let late = 1; });
show("stored in a list", () => { let name; pass([name = late]); let late = 1; });
show("stored for a constructor", () => { let name; new Made(name = late); let late = 1; });
show("added to a name", () => { let name = 1; pass(name += late); let late = 1; });
show("stored if missing", () => { let name; pass(name ??= late); let late = 1; });
show("stored if false", () => { let name; pass(name ||= late); let late = 1; });
show("object pattern", () => { let name; pass({ name } = late); let late = 1; });
show("object pattern given null", () => { let name; pass({ name } = nothing); });
show("object pattern given null, no call", () => { let name; ({ name } = nothing); });
show("list pattern", () => { let name; pass([name] = late); let late = 1; });
show("first branch", () => { pass(five ? late : 1); let late = 1; });
show("second branch", () => { pass(five === 4 ? 1 : late); let late = 1; });
show("second branch of a second branch", () => { pass(five === 4 ? 1 : five === 3 ? 2 : late); let late = 1; });
show("second branch, first argument", () => { pass(five === 4 ? 1 : late, 2); let late = 1; });
show("second branch in a sum", () => { pass(1 + (five === 4 ? 1 : late)); let late = 1; });
show("a branch that is decided", () => { pass(true ? late : 1); let late = 1; });
show("stored in a branch", () => { let name; pass(five === 4 ? 1 : name = late); let late = 1; });
