// Classes below another have an `accessor` field and no ordinary field, and `super()` is called by an arrow function or by evaluated text. Plain Bun prints another output.
const lines = [];
function note(label, value) {
  lines.push(label);
  return value;
}
class Above {
  above = note("above", "above");
}
class InAnArrow extends Above {
  accessor a = note("a", 1);
  constructor() {
    const call = () => super();
    lines.push("ahead of the call");
    const made = call();
    console.log("in an arrow:", made === this, this.a, this.above);
  }
}
class InEvaluatedText extends Above {
  accessor a = note("a", 1);
  constructor() {
    lines.push("ahead of the text");
    const made = eval("super()");
    console.log("in evaluated text:", made === this, this.a, this.above);
  }
}
class InEvaluatedTextBesideAField extends Above {
  f = note("f", 2);
  accessor a = note("a", 1);
  constructor() {
    const made = eval("super()");
    console.log("in evaluated text, beside a field:", made === this, this.a, this.f);
  }
}
class CalledTwice extends Above {
  accessor a = note("a", 1);
  constructor() {
    const made = super();
    try {
      super();
    } catch (error) {
      lines.push(error.constructor.name);
    }
    console.log("called twice:", made === this, this.a);
  }
}
for (const run of [
  () => new InAnArrow(),
  () => new InEvaluatedText(),
  () => new InEvaluatedTextBesideAField(),
  () => new CalledTwice(),
]) {
  lines.length = 0;
  try {
    const made = run();
    made.a = 10;
    console.log(lines.join(" < "), "|", made.a, Object.keys(made).join());
  } catch (error) {
    console.log(lines.join(" < "), "|", error.constructor.name);
  }
}
