// A text that a direct eval runs takes a stack trace, throws, or does not parse. Each row prints the names of the frames down to `start`.
const namesIn = stack => {
  const names = String(stack)
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, ""))
    .map(frame => (frame.includes(" (") ? frame.slice(0, frame.indexOf(" (")) : "(no name)"));
  return names.slice(0, names.indexOf("start") + 1).join(" < ");
};
let seen = "";
function look() {
  seen = namesIn(new Error().stack);
  return 1;
}
function fail() {
  throw new RangeError("thrown below the text");
}
function start(run) {
  seen = "";
  try {
    return seen + JSON.stringify(run()) + " | " + seen;
  } catch (error) {
    return error.name + " | " + namesIn(error.stack);
  }
}
const rows = {
  looks() {
    const result = eval("look()");
    return result;
  },
  throws() {
    const result = eval("fail()");
    return result;
  },
  returnedAtOnce() {
    return eval("look()");
  },
  arrow: () => eval("look()"),
  throwsItself() {
    const result = eval("throw new TypeError('thrown by the text')");
    return result;
  },
  doesNotParse() {
    const result = eval("look(");
    return result;
  },
  readsNull() {
    const result = eval("null.member");
    return result;
  },
  nested() {
    const result = eval("eval('look()')");
    return result;
  },
  definesAFunction() {
    const result = eval("(function inner() { return look(); })()");
    return result;
  },
  noText() {
    const result = eval(look());
    return result;
  },
  textFromAVariable(text = "lo" + "ok()") {
    const result = eval(text);
    return result;
  },
};
for (const [name, run] of Object.entries(rows)) console.log(name + ":", start(run));
