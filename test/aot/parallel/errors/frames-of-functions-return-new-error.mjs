// Prints which of the functions named k_.. the stack trace of an error lists, for functions that end by making the error.
const listNames = error =>
  String(error.stack)
    .split("\n")
    .map(line => /(k_[a-zA-Z]+)/.exec(line))
    .filter(Boolean)
    .map(match => match[1])
    .join(" ");
function k_show(label, make) {
  let error;
  try {
    error = make();
  } catch (thrown) {
    error = thrown;
  }
  const names = listNames(error);
  console.log(label + ":", error.constructor.name, "|", names);
  return names;
}
class Derived extends Error {}
class Holder {
  static k_static() {
    return new Error("x");
  }
  k_method() {
    return new TypeError("x");
  }
  get k_getter() {
    return new Error("x");
  }
}

for (let turn = 0; turn < 2; turn++) {
  k_show("Error", function k_error() {
    return new Error("x");
  });
  k_show("TypeError", function k_typeError() {
    return new TypeError("x");
  });
  k_show("SyntaxError", function k_syntaxError() {
    return new SyntaxError("x");
  });
  k_show("RangeError", function k_rangeError() {
    return new RangeError("x");
  });
  k_show("ReferenceError", function k_referenceError() {
    return new ReferenceError("x");
  });
  k_show("EvalError", function k_evalError() {
    return new EvalError("x");
  });
  k_show("URIError", function k_uriError() {
    return new URIError("x");
  });
  k_show("AggregateError", function k_aggregateError() {
    return new AggregateError([], "x");
  });
  k_show("called", function k_called() {
    return Error("x");
  });
  k_show("no arguments", function k_noArguments() {
    return new Error();
  });
  k_show("no parentheses", function k_noParentheses() {
    return new Error();
  });
  k_show("a cause", function k_cause() {
    return new Error("x", { cause: turn });
  });
  k_show("a spread", function k_spread() {
    return new Error(...["x"]);
  });
  k_show("a conditional", function k_conditional() {
    return turn > 5 ? null : new TypeError("x");
  });
  k_show("a logical operator", function k_logical() {
    return (turn > 5 && null) || new TypeError("x");
  });
  k_show("a comma", function k_comma() {
    return (turn, new TypeError("x"));
  });
  k_show("parentheses", function k_parentheses() {
    return new Error("x");
  });
  k_show("a variable used once", function k_variable() {
    const made = new Error("x");
    return made;
  });
  k_show("a variable used twice", function k_kept() {
    const made = new Error("x");
    made.seen = turn;
    return made;
  });
  k_show("a property of the error", function k_property() {
    return { stack: new Error("x").stack, constructor: Error };
  });
  k_show("thrown", function k_thrown() {
    throw new Error("x");
  });
  k_show("inside try", function k_try() {
    try {
      return new Error("x");
    } catch {}
  });
  k_show("inside finally", function k_finally() {
    try {
    } finally {
      return new Error("x");
    }
  });
  k_show("a class that extends Error", function k_derived() {
    return new Derived("x");
  });
  k_show("a local name", function k_local() {
    const Error = globalThis.RangeError;
    return new Error("x");
  });
  k_show("a member of globalThis", function k_member() {
    return new globalThis.Error("x");
  });
  k_show("a parameter", function k_parameter(Made = Error) {
    return new Made("x");
  });
  k_show("a parameter that is called", function k_calledParameter(make = Error) {
    return make("x");
  });
  k_show("a function of text that does not parse", function k_function() {
    return new Function("(");
  });
  k_show("a function of text that does not parse, called", function k_calledFunction() {
    return Function("(");
  });
  k_show("a function of text made here", function k_functionOfText() {
    return new Function("(".repeat(turn + 1));
  });
  k_show("an array of a length that is none", function k_array() {
    return new Array(-1 - turn);
  });
  k_show("an array of a length that is none, called", function k_calledArray() {
    return Array(-1 - turn);
  });
  k_show("a static method", Holder.k_static);
  k_show("a method", new Holder().k_method);
  k_show("a getter", function k_readsGetter() {
    const made = new Holder().k_getter;
    made.seen = turn;
    return made;
  });
  k_show("two levels", function k_outer() {
    function k_inner() {
      return new Error("x");
    }
    return k_inner();
  });
  k_show("two levels, the outer one stays", function k_stays() {
    function k_leaves() {
      return new Error("x");
    }
    const made = k_leaves();
    made.seen = turn;
    return made;
  });
  k_show("a generator", function k_runsGenerator() {
    function* k_generator() {
      return new Error("x");
    }
    const step = k_generator().next();
    return step.value;
  });
}
await (async function k_async() {
  const made = await (async function k_asyncInner() {
    return new Error("x");
  })();
  console.log("an async function:", listNames(made));
})();
