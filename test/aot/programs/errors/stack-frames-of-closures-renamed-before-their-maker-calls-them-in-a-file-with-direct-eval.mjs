// A replaced Function.prototype.toString keeps the closure it runs on. Each function creates a closure, converts it to a string, renames what was kept and calls the closure. The file also calls eval directly. Prints the names in the frames.
let kept;
function frames(error) {
  return error.stack
    .split("\n")
    .slice(1, 3)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*$/, ""))
    .join(" < ");
}
function rename(closure, name) {
  if (name) Object.defineProperty(closure, "name", { value: name });
}
function run(outer) {
  for (const name of ["first", "", "second"]) {
    try {
      outer(name);
    } catch (error) {
      console.log(frames(error));
    }
  }
}
const table = { text: 1 };
function runAll() {
  run(function concatenates(name) {
    const closure = function written1() {
      throw new Error("x");
    };
    const text = "" + closure;
    rename(kept, name);
    closure();
  });
  run(function usesAsKey(name) {
    const closure = function written2() {
      throw new Error("x");
    };
    const found = table[closure];
    rename(kept, name);
    closure();
  });
  run(function convertsToNumber(name) {
    const closure = function written3() {
      throw new Error("x");
    };
    const number = +closure;
    rename(kept, name);
    closure();
  });
  run(function constructs(name) {
    const closure = function Written4() {
      throw new Error("x");
    };
    const text = "" + closure;
    rename(kept, name);
    new closure();
  });
  run(function spreads(name) {
    const closure = function written5(...rest) {
      throw new Error("x");
    };
    const text = "" + closure;
    rename(kept, name);
    closure(...[1, 2]);
  });
  run(function callsAnArrow(name) {
    const closure = () => {
      throw new Error("x");
    };
    const text = "" + closure;
    rename(kept, name);
    closure();
  });
  run(function callsWhatCaptures(name) {
    const closure = function written8() {
      throw new Error(name);
    };
    const text = "" + closure;
    rename(kept, name);
    closure();
  });
  run(function callsThroughCall(name) {
    const closure = function written9() {
      throw new Error("x");
    };
    const text = "" + closure;
    rename(kept, name);
    closure.call(null);
  });
  run(function callsThroughApply(name) {
    const closure = function written10() {
      throw new Error("x");
    };
    const text = "" + closure;
    rename(kept, name);
    closure.apply(null, []);
  });
  run(function callsInALoop(name) {
    const closure = function written11(turn) {
      if (turn === 2) throw new Error("x");
    };
    const text = "" + closure;
    rename(kept, name);
    for (let turn = 0; turn < 3; turn++) closure(turn);
  });
  run(function renamesInABranch(name) {
    const closure = function written12() {
      throw new Error("x");
    };
    if (name !== "never") {
      const text = "" + closure;
      rename(kept, name);
    }
    closure();
  });
  run(function callsADeclaration(name) {
    function written13() {
      throw new Error("x");
    }
    const text = "" + written13;
    rename(kept, name);
    written13();
  });
}
console.log(eval("1 + 1"));
Function.prototype.toString = function () {
  kept = this;
  return "text";
};
runAll();
const method = Function.prototype.toString;
Object.defineProperty(Function.prototype, "toString", {
  get() {
    kept = this;
    return method;
  },
  configurable: true,
});
runAll();
