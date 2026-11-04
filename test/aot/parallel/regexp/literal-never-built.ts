// A regular expression literal whose pattern can never be built throws a new SyntaxError each time it is evaluated, and nothing behind it runs.
const steps: string[] = [];

function step<T>(name: string, value: T): T {
  steps.push(name);
  return value;
}

function attempt(name: string, run: () => unknown) {
  steps.length = 0;
  let outcome: string;
  try {
    outcome = `returned ${String(run())}`;
  } catch (error) {
    outcome = `${Object.getPrototypeOf(error) === SyntaxError.prototype} ${error}`;
  }
  console.log(`${name}: ${outcome} [${steps.join(" ")}]`);
}

attempt("declaration", () => {
  step("before", 0);
  const re = /a{2147483648}a{2147483648}/;
  return step("behind", re.source);
});

attempt("argument", () => step("call", [step("first", 1), /a{2147483648}a{2147483648}/g, step("last", 2)]));

function choose(takesLiteral: boolean) {
  return takesLiteral ? /a{2147483649,2147483650}a{2147483649,2147483650}/ : step("other arm", "other");
}
attempt("arm that is taken", () => choose(true));
attempt("arm that is not taken", () => choose(false));

attempt("handler of the same function", () => {
  try {
    return step("behind", /a{2147483648}a{2147483648}/.test("a"));
  } catch (error) {
    return step("caught", String(error));
  } finally {
    step("finally", 0);
  }
});

attempt("loop", () => {
  const thrown: unknown[] = [];
  for (let turn = 0; turn < 3; turn++) {
    try {
      thrown.push(/a{2147483648}a{2147483648}/);
    } catch (error) {
      thrown.push(error);
    }
  }
  return [thrown.length, thrown[0] !== thrown[1], thrown.every(error => error instanceof SyntaxError)];
});

function* generate() {
  yield step("yielded", 1);
  yield /a{2147483648}a{2147483648}/;
  yield step("behind", 2);
}
attempt("generator", () => [...generate()].length);

class Holder {
  first = step("first field", 1);
  re = /a{2147483648}a{2147483648}/;
  last = step("last field", 2);
}
attempt("field", () => new Holder().re);

function withDefault(re = /a{2147483648}a{2147483648}/) {
  return step("body", re);
}
attempt("default that is not taken", () => withDefault(/a/));
attempt("default that is taken", () => withDefault());

attempt("quantifier around a quantifier", () => /(?:a{2147483647}){2147483647}/.flags);

async function wait() {
  await step("awaited", null);
  return /a{2147483648}a{2147483648}/;
}
steps.length = 0;
wait()
  .then(String, String)
  .then(outcome => console.log(`async function: ${outcome} [${steps.join(" ")}]`));
