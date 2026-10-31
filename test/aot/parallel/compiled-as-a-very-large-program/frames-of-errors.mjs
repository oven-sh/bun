// Flags: --aot-limit=MaxWarmCodeValues:1
// As classes.ts. What error.stack says: the names and the positions of the frames, through methods, constructors, accessors, callbacks of built-ins, tail calls, async functions and errors thrown by the engine.
const frames = (error, count = 6) =>
  error.stack
    .split("\n")
    .slice(1, 1 + count)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/\(?[^ (]*[\\/]([^\\/]+:\d+:\d+)\)?$/, "$1"),
    )
    .join(" < ");
const show = (name, error) =>
  console.log(name + ": " + error.constructor.name + ": " + error.message + " | " + frames(error));
class Account {
  #balance = 0;
  constructor(opening) {
    if (opening < 0) throw new RangeError("opened below zero");
    this.#balance = opening;
  }
  get balance() {
    if (this.#balance > 1000) throw new Error("too much to say");
    return this.#balance;
  }
  set balance(value) {
    if (value !== value) throw new TypeError("not a number");
    this.#balance = value;
  }
  withdraw(amount) {
    const left = this.#balance - amount;
    if (left < 0) throw new RangeError("short by " + -left);
    this.#balance = left;
    return left;
  }
  static open(opening) {
    return new Account(opening);
  }
}
function throughMembers() {
  const account = Account.open(10);
  try {
    account.withdraw(25);
  } catch (error) {
    show("a method", error);
  }
  try {
    Account.open(-1);
  } catch (error) {
    show("a constructor under a static method", error);
  }
  try {
    account.balance = NaN;
  } catch (error) {
    show("a setter", error);
  }
  account.balance = 5000;
  try {
    console.log(account.balance);
  } catch (error) {
    show("a getter", error);
  }
}
function throughBuiltIns() {
  const fail = value => {
    throw new Error("at " + value);
  };
  try {
    [1, 2, 3].map(function double(value) {
      return value === 2 ? fail(value) : value * 2;
    });
  } catch (error) {
    show("the callback of map", error);
  }
  try {
    [3, 1, 2].sort((a, b) => (a === 2 ? fail(a) + b : a - b));
  } catch (error) {
    show("the callback of sort", error);
  }
  try {
    JSON.stringify({
      toJSON: function toJSON() {
        return fail("toJSON") + 1;
      },
    });
  } catch (error) {
    show("toJSON", error);
  }
  try {
    "abc".replace(/b/, function replacer(found) {
      return fail(found) + "";
    });
  } catch (error) {
    show("the callback of replace", error);
  }
}
function leavesByATailCall(depth) {
  if (depth === 0) throw new Error("at the bottom");
  return leavesByATailCall(depth - 1);
}
function staysBelow(depth) {
  if (depth === 0) throw new Error("at the bottom");
  return staysBelow(depth - 1) + 1;
}
function throughCalls() {
  try {
    leavesByATailCall(3);
  } catch (error) {
    show("tail calls", error);
  }
  try {
    staysBelow(3);
  } catch (error) {
    show("calls that come back", error);
  }
  try {
    null.member;
  } catch (error) {
    show("a read of null", error);
  }
  try {
    undefined();
  } catch (error) {
    show("a call of undefined", error);
  }
  try {
    notDeclaredAnywhere;
  } catch (error) {
    show("a name nobody declares", error);
  }
}
async function inner(value) {
  await null;
  if (value > 1) throw new Error("behind an await");
  return value;
}
async function outer(value) {
  const first = await inner(value);
  return first + (await inner(value + 1));
}
async function throughAwaits() {
  try {
    await outer(1);
  } catch (error) {
    show("async functions", error);
  }
  try {
    await Promise.all([inner(0), inner(5)]);
  } catch (error) {
    show("under Promise.all", error);
  }
}
// Each is called twice from code that runs once: a function that is called once counts as one that runs.
throughMembers();
throughBuiltIns();
throughCalls();
await throughAwaits();
throughMembers();
throughBuiltIns();
throughCalls();
await throughAwaits();
