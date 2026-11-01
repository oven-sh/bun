// An indirect eval runs a text that the program writes out. The text takes a stack trace or throws. Each row prints the names of the frames down to `start`.
const namesIn = stack => {
  const names = String(stack)
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, ""))
    .map(frame => (frame.includes(" (") ? frame.slice(0, frame.indexOf(" (")) : "(no name)"));
  return names.slice(0, names.indexOf("start") + 1).join(" < ");
};
globalThis.look = function look() {
  return namesIn(new Error().stack);
};
globalThis.fail = function fail() {
  throw new RangeError("thrown below the text");
};
function start(run) {
  try {
    const result = run();
    return String(result);
  } catch (error) {
    return error.name + " | " + namesIn(error.stack);
  }
}
const rows = {
  behindAComma() {
    const result = (0, eval)("look()");
    return result + "";
  },
  behindACommaThenReturned() {
    const result = (0, eval)("look()");
    return result;
  },
  behindACommaInTailPosition() {
    return (0, eval)("look()");
  },
  inAnArrowFunction: () => (0, eval)("look()"),
  throughAConstant() {
    const evaluate = eval;
    const result = evaluate("look()");
    return result + "";
  },
  throughAConstantInTailPosition() {
    const evaluate = eval;
    return evaluate("look()");
  },
  throughAnOptionalCall() {
    const result = eval?.("look()");
    return result + "";
  },
  throughAnOptionalCallInTailPosition() {
    return eval?.("look()");
  },
  throughTheGlobalObject() {
    const result = globalThis.eval("look()");
    return result + "";
  },
  throughTheGlobalObjectInTailPosition() {
    return globalThis.eval("look()");
  },
  asAStatement() {
    (0, eval)("globalThis.seen = look()");
    return globalThis.seen;
  },
  inATry() {
    try {
      return (0, eval)("look()");
    } finally {
      globalThis.seen = "";
    }
  },
  aTextInAText() {
    const result = (0, eval)("(0, eval)('look()')");
    return result + "";
  },
  theTextThrows() {
    const result = (0, eval)("fail()");
    return result + "";
  },
  theTextThrowsInTailPosition() {
    return (0, eval)("fail()");
  },
  theTextReadsFromNull() {
    const result = (0, eval)("null.member");
    return result + "";
  },
  theTextNamesNothing() {
    return (0, eval)("notDeclaredAnywhere");
  },
  theTextCallsNothing() {
    return typeof (0, eval)("this");
  },
  twoInOneFunction() {
    const first = (0, eval)("look()");
    const second = (0, eval)("look()");
    return first + " + " + second;
  },
  manyLevels(depth = 3) {
    globalThis.descend = () => rows.manyLevels(depth - 1);
    return depth ? (0, eval)("descend()") : look();
  },
};
for (const [name, row] of Object.entries(rows)) console.log(name + ": " + start(row));

const original = globalThis.eval;
globalThis.eval = function replacement(text) {
  return "replaced " + text + " | " + look();
};
console.log("replaced: " + start(() => (0, eval)("look()")));
console.log("replacedNotLast: " + start(() => (0, eval)("look()") + ""));
globalThis.eval = original;
console.log("restored: " + start(() => (0, eval)("look()")));
