const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label, run) {
  log.length = 0;
  let text;
  try {
    text = show(run());
  } catch (error) {
    text = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + text + (log.length ? " | " + log.join(", ") : ""));
}

function codeAt(x) {
  return x.charCodeAt(0);
}

function codeAfterArgument(x, argument) {
  return x.charCodeAt(argument());
}

function twoMethods(x, needle) {
  return x.charCodeAt(x.indexOf(needle));
}

function append(x, value) {
  return x.push(value);
}

function fixed(x) {
  return x.toFixed(1);
}

function upperInLoop(values) {
  let text = "";
  for (const value of values) text += value.toUpperCase();
  return text;
}

class Text {
  constructor(code) {
    this.code = code;
  }
  charCodeAt(index) {
    log.push("Text.charCodeAt " + index);
    return this.code;
  }
  indexOf(needle) {
    log.push("Text.indexOf " + needle);
    return 3;
  }
  toUpperCase() {
    return "<text>";
  }
}

class OddList extends Array {
  push(value) {
    log.push("OddList.push " + value);
    return -1;
  }
}

const logged = target =>
  new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

for (let round = 0; round < 3; round++) {
  attempt("string", () => codeAt("abc"));
  attempt("rope", () => codeAt("ab".repeat(round + 1) + round));
  attempt("empty string", () => codeAt(""));
  attempt("String object", () => codeAt(new String("xyz")));
  attempt("String object with its own method", () => {
    const text = new String("xyz");
    text.charCodeAt = () => 7;
    return codeAt(text);
  });
  attempt("class of the program", () => codeAt(new Text(65)));
  attempt("object literal", () => codeAt({ charCodeAt: index => index + 100 }));
  attempt("getter", () =>
    codeAt({
      get charCodeAt() {
        log.push("getter");
        return () => 8;
      },
    }),
  );
  attempt("proxy", () => codeAt(logged(new String("q"))));
  attempt("object that inherits from String.prototype", () => codeAt({ __proto__: String.prototype, toString: () => "z" }));
  attempt("number", () => codeAt(5));
  attempt("undefined", () => codeAt(undefined));
  attempt("null", () => codeAt(null));
  attempt("object without the method", () => codeAt({}));
  attempt("member is not callable", () => codeAt({ charCodeAt: 3 }));

  attempt("the read comes before the argument", () =>
    codeAfterArgument(
      {
        get charCodeAt() {
          log.push("read");
          return () => 9;
        },
      },
      () => (log.push("argument"), 0),
    ),
  );
  attempt("null receiver, argument never runs", () => codeAfterArgument(null, () => (log.push("argument"), 0)));
  attempt("string, argument runs", () => codeAfterArgument("k", () => (log.push("argument"), 0)));

  attempt("two methods, string", () => twoMethods("hello", "l"));
  attempt("two methods, class of the program", () => twoMethods(new Text(66), "l"));
  attempt("two methods, array has only one", () => twoMethods(["l"], "l"));

  attempt("array", () => {
    const list = [1];
    return [append(list, 2), list];
  });
  attempt("subclass of Array", () => append(new OddList(), 2));
  attempt("array with its own push", () => {
    const list = [];
    list.push = () => "own";
    return append(list, 2);
  });
  attempt("frozen array", () => append(Object.freeze([1]), 2));
  attempt("array-like", () => {
    const like = { length: 1, push: Array.prototype.push };
    return [append(like, "v"), like.length, like[1]];
  });
  attempt("string has no push", () => append("text", 2));

  attempt("number", () => fixed(1.25));
  attempt("integer", () => fixed(3));
  attempt("Number object", () => fixed(new Number(2.5)));
  attempt("string has no toFixed", () => fixed("1.25"));
  attempt("object with toFixed", () => fixed({ toFixed: digits => "digits " + digits }));

  attempt("loop over strings", () => upperInLoop(["a", "b"]));
  attempt("loop meets another receiver", () => upperInLoop(["a", new Text(1), "c"]));
  attempt("loop meets undefined", () => upperInLoop(["a", undefined, "c"]));
}

Number.prototype.charCodeAt = function (index) {
  return "number " + this + " at " + index;
};
attempt("number, after Number.prototype got the name", () => codeAt(5));
String.prototype.push = function (value) {
  return "push of " + this + " " + value;
};
attempt("object, after String.prototype got the name", () => append({}, 1));
attempt("string, after String.prototype got the name", () => append("text", 1));
attempt("array, after String.prototype got the name", () => append([], 1));
