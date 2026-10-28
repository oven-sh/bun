function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function plus(a, b) {
  return a + b;
}

const replacements = [
  ["another function", () => (a, b) => a - b],
  ["a bound function", () => plus.bind(null, 100)],
  ["a callable proxy", () => new Proxy(plus, { apply: (target, self, list) => "trapped " + list.join() })],
  ["a class", () => class {}],
  ["an async function", () => async (a, b) => a + b],
  ["a generator function", () => function* (a, b) { yield a + b; }],
  ["a native function", () => Math.max],
  ["an object with call", () => ({ call: () => "its own call" })],
  ["a string", () => "plus"],
  ["undefined", () => undefined],
];

function collect(count, step) {
  const out = [];
  try {
    for (let i = 0; i < count; i++) out.push(show(step(i)));
  } catch (error) {
    out.push("threw " + error.constructor.name);
  }
  return out.join(" ");
}

let variable = plus;

function throughAVariable(replacement) {
  variable = plus;
  return collect(6, i => {
    if (i === 3) variable = replacement;
    return variable(i, 1);
  });
}

function throughAVariableChangedByTheCallee(replacement) {
  variable = (a, b) => {
    if (a === 2) variable = replacement;
    return a + b;
  };
  return collect(6, i => variable(i, 1));
}

function throughAVariableChangedByAnArgument(replacement) {
  variable = plus;
  return collect(4, i => variable(i, i === 2 ? ((variable = replacement), 1) : 1));
}

const holder = { run: plus };

function throughAField(replacement) {
  holder.run = plus;
  return collect(6, i => {
    if (i === 3) holder.run = replacement;
    return holder.run(i, 1);
  });
}

function throughAFieldChangedByAnArgument(replacement) {
  holder.run = plus;
  return collect(4, i => holder.run(i, i === 2 ? ((holder.run = replacement), 1) : 1));
}

class Tool {
  run(a, b) {
    return a + b;
  }
}

function throughThePrototype(replacement) {
  const original = Tool.prototype.run;
  const tool = new Tool();
  const result = collect(6, i => {
    if (i === 3) Tool.prototype.run = replacement;
    return tool.run(i, 1);
  });
  Tool.prototype.run = original;
  return result;
}

function throughAnOwnMemberThatHidesTheMethod(replacement) {
  const tool = new Tool();
  return collect(6, i => {
    if (i === 3) tool.run = replacement;
    if (i === 5) delete tool.run;
    return tool.run(i, 1);
  });
}

function throughAnotherPrototype(replacement) {
  const tool = new Tool();
  return collect(6, i => {
    if (i === 3) Object.setPrototypeOf(tool, { run: replacement });
    return tool.run(i, 1);
  });
}

function throughAnElement(replacement) {
  const table = [plus];
  return collect(6, i => {
    if (i === 3) table[0] = replacement;
    return table[0](i, 1);
  });
}

function throughAGetter(replacement) {
  let reads = 0;
  const object = { get run() { return ++reads > 3 ? replacement : plus; } };
  return collect(6, i => object.run(i, 1));
}

function throughAParameter(replacement) {
  function loop(f) {
    return collect(6, i => {
      if (i === 3) f = replacement;
      return f(i, 1);
    });
  }
  return loop(plus);
}

for (let i = 0; i < 2000; i++) {
  variable(i, 1);
  holder.run(i, 1);
  new Tool().run(i, 1);
}
for (const [name, make] of replacements) {
  console.log("a variable becomes " + name + ":", throughAVariable(make()));
  console.log("the callee changes the variable to " + name + ":", throughAVariableChangedByTheCallee(make()));
  console.log("an argument changes the variable to " + name + ":", throughAVariableChangedByAnArgument(make()));
  console.log("a field becomes " + name + ":", throughAField(make()));
  console.log("an argument changes the field to " + name + ":", throughAFieldChangedByAnArgument(make()));
  console.log("the method on the prototype becomes " + name + ":", throughThePrototype(make()));
  console.log("an own member hides the method, " + name + ":", throughAnOwnMemberThatHidesTheMethod(make()));
  console.log("another prototype has " + name + ":", throughAnotherPrototype(make()));
  console.log("an element becomes " + name + ":", throughAnElement(make()));
  console.log("a getter starts to answer " + name + ":", throughAGetter(make()));
  console.log("a parameter becomes " + name + ":", throughAParameter(make()));
}
