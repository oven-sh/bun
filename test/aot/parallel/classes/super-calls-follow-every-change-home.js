// `super.run()` looks the method up above the home object, each time it is evaluated. Each family is asked in a loop, something above its home object changes, and it is asked again.
const unseen = new Function("value", "return value");
const lines = [];
function say(...parts) {
  lines.push(parts.join(" "));
}

function ask(label, object, rounds = 300) {
  let sum = 0;
  let last;
  for (let round = 0; round < rounds; round++) {
    last = object.run(round);
    sum += typeof last === "number" ? last : 0;
  }
  say(label, sum, String(last));
}

// The method above is replaced.
{
  class Above { run(n) { return n + 1; } }
  class Below extends Above { run(n) { return super.run(n) * 2; } }
  const object = new Below();
  ask("replaced, before", object);
  unseen(Above).prototype.run = function (n) { return n + 100; };
  ask("replaced, behind", object);
  Above.prototype.run = function (n) { return -n; };
  ask("replaced in sight", object);
}

// The method above is deleted: the lookup goes on one class higher, then finds nothing.
{
  class Top { run(n) { return n + 7; } }
  class Middle extends Top { run(n) { return n + 70; } }
  class Below extends Middle { run(n) { return super.run(n); } }
  const object = new Below();
  ask("deleted, before", object);
  delete unseen(Middle).prototype.run;
  ask("deleted once", object);
  delete unseen(Top).prototype.run;
  try {
    ask("deleted twice", object);
  } catch (error) {
    say("deleted twice", error.constructor.name);
  }
}

// The prototype object of the class gets another parent.
{
  class Above { run(n) { return n + 1; } }
  class Other { run(n) { return n + 1000; } }
  class Below extends Above { run(n) { return super.run(n); } }
  const object = new Below();
  ask("another parent, before", object);
  Object.setPrototypeOf(unseen(Below).prototype, Other.prototype);
  ask("another parent, behind", object);
  Object.setPrototypeOf(Below.prototype, { run(n) { return "literal " + n; } });
  ask("a literal as parent", object);
  Object.setPrototypeOf(Below.prototype, null);
  try {
    ask("no parent", object);
  } catch (error) {
    say("no parent", error.constructor.name);
  }
}

// A method is put between: the class in the middle declares none at first.
{
  class Top { run(n) { return n; } }
  class Middle extends Top {}
  class Below extends Middle { run(n) { return super.run(n) + 1; } }
  const object = new Below();
  ask("put between, before", object);
  unseen(Middle).prototype.run = function (n) { return n * 10; };
  ask("put between, behind", object);
}

// The home object stays what it was, whoever the receiver is and wherever the method is carried to.
{
  class Above { run(n) { return "above " + this.tag + " " + n; } }
  class Below extends Above { constructor() { super(); this.tag = "below"; } run(n) { return super.run(n); } }
  class Stranger { constructor() { this.tag = "stranger"; } run(n) { return "never " + n; } }
  const borrowed = Below.prototype.run;
  const stranger = new Stranger();
  stranger.run = borrowed;
  ask("borrowed", stranger, 50);
  say("called on a literal", borrowed.call({ tag: "literal" }, 3));
  say("an own property of the receiver is passed by", (() => { const object = new Below(); object.run = () => "own"; return Below.prototype.run.call(object, 4); })());
}

// An accessor above, a field above, a value that is no function.
{
  class Above { get run() { return (n) => "from a getter " + n; } }
  class Below extends Above { run(n) { return super.run(n); } }
  ask("a getter above", new Below(), 40);
  Object.defineProperty(unseen(Above).prototype, "run", { value: (n) => "a value now " + n, configurable: true });
  ask("a value above", new Below(), 40);
  Object.defineProperty(Above.prototype, "run", { value: 5, configurable: true });
  try {
    ask("a number above", new Below(), 40);
  } catch (error) {
    say("a number above", error.constructor.name);
  }
}

// The static side.
{
  class Above { static run(n) { return n + 2; } }
  class Below extends Above { static run(n) { return super.run(n) * 3; } }
  ask("static, before", Below);
  unseen(Above).run = (n) => n + 200;
  ask("static, replaced", Below);
  Object.setPrototypeOf(unseen(Below), { run: (n) => "static literal " + n });
  ask("static, another parent", Below);
}

// Object literals have home objects too.
{
  const above = { run(n) { return n + 3; } };
  const below = { __proto__: above, run(n) { return super.run(n) + 1; } };
  ask("literals, before", below);
  unseen(above).run = (n) => n + 300;
  ask("literals, replaced", below);
  Object.setPrototypeOf(below, { run: (n) => "other literal " + n });
  ask("literals, another parent", below);
}

// Arrows and inner functions inside the method, arguments with effects, spread.
{
  const order = [];
  class Above { run(a, b) { order.push("run"); return a + b; } }
  class Below extends Above {
    run(n) {
      const arrow = () => super.run((order.push("first"), n), (order.push("second"), 1));
      return arrow() + super.run(...[n, 2]);
    }
  }
  const object = new Below();
  ask("arrows", object, 20);
  say("order", order.slice(0, 8).join(","));
  let replaced = false;
  class Late extends Above { run(n) { return super.run(n, (replaced || (replaced = true, Above.prototype.run = (a, b) => a * 1000 + b), 5)); } }
  ask("the method is read in front of the arguments", new Late(), 3);
}

// Built-in classes above.
{
  class List extends Array { push(value) { return super.push(value * 2); } }
  const list = new List();
  for (let n = 0; n < 50; n++) list.push(n);
  say("array", list.length, list[49]);
  const push = Array.prototype.push;
  class Failure extends Error { toString() { return "<" + super.toString() + ">"; } }
  say("error", String(new Failure("told")));
  class Table extends Map { set(key, value) { return super.set(key, value + 1); } get(key) { return super.get(key) ?? "none"; } }
  const table = new Table();
  for (let n = 0; n < 50; n++) table.set(n, n);
  say("map", table.size, table.get(49), table.get(50), push === Array.prototype.push);
}

// A class text that is evaluated more than once: each evaluation has a home object of its own.
{
  function make(parent, factor) {
    return class extends parent { run(n) { return super.run(n) * factor; } };
  }
  class One { run(n) { return n + 1; } }
  class Two { run(n) { return n + 2; } }
  const first = make(One, 10), second = make(Two, 100), third = make(first, 2);
  ask("first evaluation", new first(), 30);
  ask("second evaluation", new second(), 30);
  ask("third evaluation", new third(), 30);
  unseen(One).prototype.run = (n) => n;
  ask("first evaluation, changed", new first(), 30);
  ask("third evaluation, changed", new third(), 30);
}

// Below a constructor function.
{
  function Old() {}
  Old.prototype.run = function (n) { return n + 4; };
  class Below extends Old { run(n) { return super.run(n) + 1; } }
  ask("below a function, before", new Below());
  unseen(Old).prototype.run = function (n) { return n + 400; };
  ask("below a function, replaced", new Below());
  Old.prototype = { run: () => "never: the link was made at the definition" };
  ask("below a function, another prototype object", new Below());
}

console.log(lines.join("\n"));
