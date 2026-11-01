// A static block hands text to a direct eval. The text sees what the block's own code sees, and the `arguments` of the block.
const lines = [];
const say = (name, make) => {
  let answer;
  try {
    answer = make();
  } catch (error) {
    answer = error.constructor.name + ": " + error.message;
  }
  lines.push(name + ": " + (typeof answer === "string" ? answer : JSON.stringify(answer)));
};
const evaluate = text => {
  let seen;
  class Parent {
    static inherited = "from the parent";
  }
  class Self extends Parent {
    static #hidden = "hidden";
    static shown = "shown";
    static {
      seen = eval(text);
    }
  }
  return seen;
};

for (const text of [
  "arguments.length",
  "typeof arguments",
  "String(arguments[0])",
  "Object.prototype.toString.call(arguments)",
  "Object.keys(arguments)",
  "Array.from(arguments)",
  "(() => arguments.length)()",
  "(() => () => arguments.length)()()",
  "(function () { return arguments.length; })(1, 2)",
  'eval("arguments.length")',
  '(() => eval("arguments.length"))()',
  "arguments === arguments",
  "arguments.callee",
  "arguments = 1",
  "var arguments = 1",
  "let arguments = 1",
  "arguments[0] = 4, arguments[0]",
  "String(new.target)",
  "(() => String(new.target))()",
  "this.shown",
  "this.#hidden",
  "Self.#hidden",
  "#hidden in this",
  "this.#missing",
  "super.inherited",
  "(() => super.inherited)()",
  "super()",
  "typeof await",
  "await 1",
  "typeof Self",
  "return 1",
  "var made = 3; made",
]) {
  say(text, () => evaluate(text));
}

say("in a function that has arguments", () => {
  let seen;
  (function () {
    class Self {
      static {
        seen = [eval("arguments.length"), (() => eval("arguments.length"))()];
      }
    }
  })(1, 2, 3);
  return seen;
});
say("two blocks have two objects", () => {
  const seen = [];
  class Self {
    static {
      seen.push(eval("arguments"));
    }
    static {
      seen.push(eval("arguments"));
    }
  }
  return [seen[0] === seen[1], seen[0].length, seen[1].length];
});
say("one block has one object", () => {
  let seen;
  class Self {
    static {
      seen = eval("arguments") === eval("arguments");
    }
  }
  return seen;
});
say("the object outlives the block", () => {
  let read;
  class Self {
    static {
      read = eval("arguments[0] = 'kept'; () => arguments[0]");
    }
  }
  return read();
});
say("a field beside the block", () => {
  class Self {
    static field = eval("arguments.length");
  }
  return Self.field;
});

console.log(lines.join("\n"));
