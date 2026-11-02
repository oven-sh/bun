// The right side of `instanceof` is an object, an array, a proxy or a namespace, not a function, or its Symbol.hasInstance is no function. The message quotes the expression where both sides consist of names.
function tell(ask) {
  try {
    console.log(ask());
  } catch (error) {
    console.log(error.constructor.name + ": " + error.message);
  }
}
const value = {};
const holder = { inner: { deep: {} }, list: [{}, {}], "a-b": {}, 5: {} };
const list = [1, 2];
const proxy = new Proxy([1, 2], {});
const key = "inner";
const index = 1;
const withNumber = { [Symbol.hasInstance]: 5 };
const withText = { [Symbol.hasInstance]: "text" };
const withUndefined = { [Symbol.hasInstance]: undefined };
const withNull = { [Symbol.hasInstance]: null };
class WithNumber {
  static [Symbol.hasInstance] = 5;
}

tell(() => value instanceof holder);
tell(() => value instanceof list);
tell(() => value instanceof proxy);
tell(() => value instanceof holder.inner);
tell(() => value instanceof holder.inner.deep);
tell(() => value instanceof holder[key]);
tell(() => value instanceof holder["inner"]);
tell(() => value instanceof holder["a-b"]);
tell(() => value instanceof holder[5]);
tell(() => value instanceof holder["5"]);
tell(() => value instanceof holder.list[0]);
tell(() => value instanceof holder.list[index]);
tell(() => value instanceof holder?.inner);
tell(() => value?.absent instanceof holder);
tell(() => holder.inner instanceof holder);
tell(() => holder.inner.deep instanceof holder.inner);
tell(() => holder.list[1] instanceof holder);
tell(() => value instanceof Math);
tell(() => value instanceof JSON);
tell(() => value instanceof globalThis);
tell(() => globalThis instanceof holder);

tell(() => null instanceof holder);
tell(() => undefined instanceof holder);
tell(() => true instanceof holder);
tell(() => false instanceof holder);
tell(() => NaN instanceof holder);
tell(() => Infinity instanceof holder);

tell(() => value instanceof withNumber);
tell(() => value instanceof withText);
tell(() => value instanceof withUndefined);
tell(() => value instanceof withNull);
tell(() => value instanceof WithNumber);
tell(() => null instanceof withNumber);

// No text is quoted in these.
tell(() => value instanceof 5);
tell(() => value instanceof undefined);
tell(() => value instanceof null);
tell(() => value instanceof "text");
tell(() => value instanceof Symbol.iterator);
tell(() => value instanceof (() => {}));
tell(() => value instanceof { method() {} }.method);

// Parentheses, blanks, comments and operands that are dropped are not part of the text.
// prettier-ignore
tell(() => (value) instanceof (holder));
// prettier-ignore
tell(() => value   instanceof   holder);
tell(() => value /* left */ instanceof /* right */ holder);
// prettier-ignore
tell(() => value
  instanceof
  holder);
tell(() => (0, value) instanceof holder);
tell(() => value instanceof (0, holder));
tell(() => (value, value) instanceof holder);
tell(() => (1 && value) instanceof holder);
tell(() => value instanceof (0 || holder));
tell(() => [value][0] instanceof holder);
tell(() => value instanceof [holder][0]);

// Wherever the expression stands.
tell(() => !(value instanceof holder));
tell(() => (value instanceof holder ? 1 : 2));
tell(() => value instanceof holder && 1);
tell(() => [value instanceof holder]);
tell(() => `${value instanceof holder}`);
tell(() => typeof (value instanceof holder));
tell(() => (value instanceof holder) instanceof holder);
tell(() => {
  if (value instanceof holder) return 1;
  return 2;
});
tell(() => {
  value instanceof holder;
  return "not reached";
});
tell(() => {
  while (value instanceof holder) return 1;
});
tell(() => {
  switch (true) {
    case value instanceof holder:
      return 1;
  }
});

function inTry(left, right) {
  try {
    return left instanceof right;
  } catch (error) {
    return error.message;
  }
}
console.log(inTry(value, holder));
console.log(inTry(value, list));
console.log(inTry(value, withNumber));
console.log(inTry(value, Object));
console.log(inTry(value, Array));

function takesPattern(left, { right }, ...rest) {
  return [left instanceof right, left instanceof rest];
}
tell(() => takesPattern(value, { right: holder }));
tell(() => takesPattern(value, { right: Object }));

function hasLongNames(aLongNameOfTheFirstParameterOfThisFunction, aLongNameOfTheSecondParameterOfThisFunction) {
  return aLongNameOfTheFirstParameterOfThisFunction instanceof aLongNameOfTheSecondParameterOfThisFunction;
}
tell(() => hasLongNames(value, holder));

class Base {
  static table = {};
}
class Derived extends Base {
  field = {};
  #hidden = {};
  static fixed = {};
  static #sealed = {};
  askField(left) {
    return left instanceof this.field;
  }
  askHidden(left) {
    return left instanceof this.#hidden;
  }
  askOnTheLeft(right) {
    return this.#hidden instanceof right;
  }
  askThis(right) {
    return this instanceof right;
  }
  static askFixed(left) {
    return left instanceof this.fixed;
  }
  static askSealed(left) {
    return left instanceof Derived.#sealed;
  }
  static askSuper(left) {
    return left instanceof super.table;
  }
}
tell(() => new Derived().askField(value));
tell(() => new Derived().askHidden(value));
tell(() => new Derived().askOnTheLeft(holder));
tell(() => new Derived().askThis(holder));
tell(() => new Derived().askThis(Derived));
tell(() => Derived.askFixed(value));
tell(() => Derived.askSealed(value));
tell(() => Derived.askSuper(value));

for (const each of [holder, list, Object]) tell(() => value instanceof each);
try {
  throw holder;
} catch (caught) {
  tell(() => value instanceof caught);
}

// The traps of a proxy and a getter run before the refusal, once.
const seen = [];
const watched = new Proxy({}, { get: (target, name) => (seen.push(String(name)), undefined) });
tell(() => value instanceof watched);
const computed = {
  get [Symbol.hasInstance]() {
    seen.push("getter");
    return 5;
  },
};
tell(() => value instanceof computed);
console.log(seen.join());

// In text that is evaluated: text that the program spells out, and text that is made while it runs.
globalThis.left = value;
globalThis.right = holder;
tell(() => new Function("value", "holder", "return value instanceof holder")(value, holder));
tell(() => (0, eval)("left instanceof right"));
tell(() => eval("value instanceof holder"));
const operator = process.argv.length > 100 ? "in" : "instanceof";
tell(() => new Function("value", "holder", "return value " + operator + " holder")(value, holder));
tell(() => (0, eval)("left " + operator + " right"));
tell(() => (0, eval)("({}) " + operator + " ({})"));
