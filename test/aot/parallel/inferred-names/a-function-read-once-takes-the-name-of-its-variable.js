// Prints the names of functions, arrows and classes that a `let` or `const` names and that are read once, and of functions that a block declares: each has the name of its variable, also in a stack trace.
const nameOf = f => f.name;
const frame = e => e.stack.split("\n")[1].match(/at (?:new )?(\S+) \(/)?.[1];
const row = (label, run) => {
  let value;
  try {
    value = run();
  } catch (error) {
    value = "throws " + error.name;
  }
  console.log(label + ":", JSON.stringify(value));
};

row("an arrow", () => { const q = () => {}; return q.name; });
row("a function", () => { let q = function () {}; return q.name; });
row("a class", () => { const Q = class {}; return Q.name; });
row("an async arrow", () => { const q = async () => {}; return q.name; });
row("a generator", () => { const q = function* () {}; return q.name; });
row("an argument", () => { const q = () => {}; return nameOf(q); });
row("a frame", () => { const q = () => frame(new Error()); const top = q(); return top; });
row("an instance", () => { const Q = class {}; return new Q().constructor.name; });
row("a bound function", () => { const q = () => {}; return q.bind(null).name; });

// A read in a place that names a function gives no second name.
row("a property", () => { const q = () => {}; const o = { k: q }; return o.k.name; });
row("an assignment", () => { let sink; const q = () => {}; sink = q; return sink.name; });
row("a second declaration", () => { const a = () => {}; const b = a; return b.name + b.name; });
row("an operand", () => { const q = () => {}; const w = q ?? 1; return w.name + w.name; });
row("an element", () => { const f = () => 0; const a = [f]; return a[0].name; });

row("a function in a block", () => { { function q() {} return q.name; } });
row("a function in an arm of if", () => { if (row) { function q() {} return nameOf(q); } });
row("a frame of a function in a block", () => { { function q() { return frame(new Error()); } const top = q(); return top; } });
row("a function in a clause", () => { switch (1) { case 1: function q() {} return q.name; } });

row("a function with its own name", () => { const q = function named() {}; return q.name; });
