// Prints the names, lines and columns in stack traces taken below calls of functions that a `const` or `let` used once holds.
function where() {
  return (new Error().stack ?? "")
    .split("\n")
    .slice(1, 5)
    .map(line => line.trim().replace(/\(?[^ ()]*:(\d+:\d+)\)?$/, "$1"))
    .join(" | ");
}
function plain(n) {
  const here = where();
  return here + (n ? "" : ".");
}
async function waits(n) {
  const here = where();
  return here + (n ? "" : ".");
}
function pick() {
  return plain;
}
function text(value) {
  return String(value) + "";
}
const holder = { plain };

const forms = {
  arrow(n) {
    const next = () => plain(n + 1);
    const value = next();
    return [value];
  },
  arrowReturned(n) {
    const next = () => plain(n + 1);
    const value = next();
    return value;
  },
  arrowWithParameter(n) {
    const next = x => plain(x + 1);
    const value = next(n);
    return [value];
  },
  arrowWithBlock(n) {
    const next = () => {
      return plain(n + 1);
    };
    const value = next();
    return [value];
  },
  functionExpression(n) {
    const next = function () {
      return plain(n + 1);
    };
    const value = next();
    return [value];
  },
  inTheNextStatement(n) {
    const next = () => plain(n + 1);
    return [next()];
  },
  behindACall(n) {
    const next = () => plain(n + 1);
    plain(0);
    return [next()];
  },
  heldInLet(n) {
    let next = () => plain(n + 1);
    return [next()];
  },
  twoStatements(n) {
    const next = () => {
      plain(0);
      return plain(n + 1);
    };
    return [next()];
  },
  first(n) {
    const next = () => plain(n + 1);
    return [next(), 1];
  },
  behindANumber(n) {
    const next = () => plain(n + 1);
    return [1, next()];
  },
  behindAName(n) {
    const next = () => plain(n + 1);
    return [n, next()];
  },
  behindACallInTheList(n) {
    const next = () => plain(n + 1);
    return [plain(1), next()].slice(1);
  },
  optional(n) {
    const next = () => plain(n + 1);
    return [next?.()];
  },
  withAnArgument(n) {
    const next = () => plain(n + 1);
    return [next(1)];
  },
  inACondition(n) {
    const next = () => plain(n + 1);
    if (n) return [next()];
    return 0;
  },
  asTheCondition(n) {
    const next = () => plain(n + 1);
    if (next()) return [1];
    return 0;
  },
  besideALet(n) {
    let next = () => plain(n + 1),
      other = 1;
    return [next(), other];
  },
  besideAText(n) {
    const next = () => plain(n + 1),
      other = "text";
    return [next(), other];
  },
  behindANumberInAConstant(n) {
    const other = 1;
    const next = () => plain(n + 1);
    return [other, next()];
  },
  besideANumberBehindACall(n) {
    plain(0);
    const next = () => plain(n + 1),
      other = 1;
    return [next(), other];
  },
  besideAnother(n) {
    const next = () => plain(n + 1),
      other = 1;
    return [next(), other];
  },
  twoFunctions(n) {
    const one = () => plain(n + 1);
    const two = () => plain(n + 2);
    return [one(), two()];
  },
  resultOfACall(n) {
    const next = pick();
    return [next(n)];
  },
  resultOfACallBehindAName(n) {
    const next = pick();
    return [n, next(n)];
  },
  member(n) {
    const next = holder.plain;
    return [next(n)];
  },
  copied(n) {
    const next = () => plain(n + 1);
    const copy = next;
    return [copy()];
  },
  usedTwice(n) {
    const next = () => plain(n + 1);
    return [next(), next].slice(0, 1);
  },
  inAnObject(n) {
    const next = () => plain(n + 1);
    return [{ value: next() }.value + ""];
  },
  inATemplate(n) {
    const next = () => plain(n + 1);
    return `${next()}`;
  },
  asAnArgument(n) {
    const next = () => plain(n + 1);
    return text(next());
  },
  inASum(n) {
    const next = () => plain(n + 1);
    return n + next();
  },
  inAChoice(n) {
    const next = () => plain(n + 1);
    return n ? [next()] : 0;
  },
  thrown(n) {
    const next = () => plain(n + 1);
    try {
      throw next();
    } catch (value) {
      return value;
    }
  },
  inASwitch(n) {
    const next = () => plain(n + 1);
    switch (next()) {
      default:
        return seen;
    }
  },
  assigned(n) {
    const next = () => plain(n + 1);
    let value;
    value = next();
    return [value];
  },
};
let seen = "";
for (const [name, form] of Object.entries(forms)) console.log(name + ": " + String(form(1)));

const asynchronous = {
  async method(n, ...rest) {
    const next = () => waits(n + 1);
    const value = await next();
    return value;
  },
  async methodWithoutRest(n) {
    const next = () => waits(n + 1);
    const value = await next();
    return value;
  },
  async plainCallee(n) {
    const next = () => plain(n + 1);
    const value = next();
    return value;
  },
  async awaitedInAList(n) {
    const next = () => waits(n + 1);
    return [await next()];
  },
};
for (const [name, form] of Object.entries(asynchronous)) console.log(name + ": " + String(await form(1)));
