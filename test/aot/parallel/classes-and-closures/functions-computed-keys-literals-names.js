// Arrows, functions, classes, methods and accessors under computed keys of object literals: a text, a number, a symbol, a key that only the run knows. Another function is stored under the same key just before.
const log = [];
const show = value => (typeof value === "symbol" ? String(value) : JSON.stringify(value));
const nameOf = made => {
  const found = Object.getOwnPropertyDescriptor(made, "name");
  return `${show(made.name)} ${found ? show(found.value) + (found.writable ? "w" : "-") + (found.enumerable ? "e" : "-") + (found.configurable ? "c" : "-") : "none"}`;
};
const say = (title, key, made) => log.push(`${title} ${show(key)}: ${nameOf(made)}`);

const described = Symbol("described");
const bare = Symbol();
const shared = Symbol.for("shared");
const late = "late" + (process.argv.length > 99 ? 1 : 0);
const everyKey = ["text", "two words", "", 7, 1.5, -1, described, bare, shared, Symbol.iterator, late];

const makers = {
  arrow: (target, key) => {
    target[key] = given => [String(key), given].join();
    target[key] = { [key]: () => key }[key];
  },
  function: (target, key) => {
    target[key] = function (given) {
      return [String(key), given].join();
    };
    target[key] = {
      [key]: function () {
        return key;
      },
    }[key];
  },
  namedFunction: (target, key) => {
    target[key] = given => [String(key), given].join();
    target[key] = {
      [key]: function written() {
        return key;
      },
    }[key];
  },
  method: (target, key) => {
    target[key] = given => [String(key), given].join();
    target[key] = {
      [key]() {
        return key;
      },
    }[key];
  },
  asyncArrow: (target, key) => {
    target[key] = given => [String(key), given].join();
    target[key] = { [key]: async () => key }[key];
  },
  generator: (target, key) => {
    target[key] = given => [String(key), given].join();
    target[key] = {
      *[key]() {
        yield key;
      },
    }[key];
  },
  class: (target, key) => {
    target[key] = class {};
    target[key] = { [key]: class {} }[key];
  },
  classWithName: (target, key) => {
    target[key] = class {};
    target[key] = {
      [key]: class {
        static name = "own";
      },
    }[key];
  },
  getter: (target, key) => {
    target[key] = given => [String(key), given].join();
    target[key] = Object.getOwnPropertyDescriptor(
      {
        get [key]() {
          return key;
        },
      },
      key,
    ).get;
  },
  setter: (target, key) => {
    target[key] = given => [String(key), given].join();
    target[key] = Object.getOwnPropertyDescriptor({ set [key](given) {} }, key).set;
  },
};

for (const title of Object.keys(makers)) {
  const target = {};
  for (const key of everyKey) {
    makers[title](target, key);
    say(title, key, target[key]);
  }
}

// One key out of a written list.
{
  const target = {};
  ["b"].map(name => {
    target[name] = given => [name, given].join();
    target[name] = { [name]: () => name }[name];
  });
  say("a list of one", "b", target.b);
  log.push(target.b());
}

// Several keys out of a written list.
{
  const target = {};
  ["b", "c", 3].map(name => {
    target[name] = given => [name, given].join();
    target[name] = { [name]: () => name }[name];
  });
  say("a list of three", "b", target.b);
  say("a list of three", "c", target.c);
  say("a list of three", 3, target[3]);
  log.push([target.b(), target.c(), target[3]()].join());
}

// The name is read where the function is made, and both functions are kept.
{
  const kept = [];
  [described].forEach(key => {
    const target = {};
    target[key] = given => [String(key), given].join();
    kept.push(target[key]);
    const made = { [key]: () => key };
    log.push(`where it is made: ${show(made[key].name)}`);
    target[key] = made[key];
    kept.push(target[key]);
  });
  for (const made of kept) say("kept", described, made);
}

// A function that is called with one key, and one that is called with two.
function defineUnder(target, key) {
  target[key] = given => [key, given].join();
  target[key] = { [key]: () => key }[key];
  return target[key];
}
say("one call", "only", defineUnder({}, "only"));
function defineUnderEither(target, key) {
  target[key] = given => [key, given].join();
  target[key] = { [key]: () => key }[key];
  return target[key];
}
say("two calls", "first", defineUnderEither({}, "first"));
say("two calls", "second", defineUnderEither({}, "second"));

// On a prototype object, in a loop, and at the top of the file.
{
  const Holder = class {};
  for (const name of ["looped"]) {
    Holder.prototype[name] = given => [name, given].join();
    Holder.prototype[name] = { [name]: () => name }[name];
  }
  say("a prototype object", "looped", new Holder().looped);
}
const top = {};
const topKey = "top";
top[topKey] = given => [topKey, given].join();
top[topKey] = { [topKey]: () => topKey }[topKey];
say("the top of the file", topKey, top.top);

// The name can be replaced and removed afterwards.
{
  const target = {};
  ["renamed"].map(name => {
    target[name] = given => [name, given].join();
    target[name] = { [name]: () => name }[name];
  });
  Object.defineProperty(target.renamed, "name", { value: "another" });
  say("replaced", "renamed", target.renamed);
  delete target.renamed.name;
  say("removed", "renamed", target.renamed);
}

// The function that throws is shown under its name.
{
  const target = {};
  ["thrower"].map(name => {
    target[name] = given => [name, given].join();
    target[name] = {
      [name]: () => {
        throw new Error(name);
      },
    }[name];
  });
  try {
    target.thrower();
  } catch (error) {
    log.push(error.stack.split("\n")[1].trim().split(" ").slice(0, 2).join(" "));
  }
}

console.log(log.join("\n"));
