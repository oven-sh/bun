// Flags: --aot-check=verify-each-stage
import { tell, attempt, lines } from "./barrel.js";
await (async function scene1() {
  class First1 {
    constructor(...given) {
      this.from = "First1";
    }
    m(...given) {
      return "First1.m on " + (this?.from ?? typeof this) + "/" + given.length;
    }
  }
  attempt("defined", () => {
    Below1 = class Below1 extends tell("heritage", First1) {
      other() {
      }
    };
  });
})();
await (async function scene2() {
  attempt("made", () => {
    const made = Reflect.construct(Below2, [1], Second2);
    for (const name of ["m", "other", "removes"]) if (typeof made[name] === "function") attempt(name, () => made[name](1));
    if ("g" in made) {
    }
    if (made.late) kept.push(made.late());
  });
})();
await (async function scene3() {
  class First3 {
    constructor(...given) {
      this.from = "First3";
    }
    m(...given) {
    }
  }
  let Below3;
  attempt("defined", () => {
    Below3 = class Below3 extends tell("heritage", First3) {
      constructor() {
      }
      set g(given) {
      }
    };
  });
  attempt("made", () => {
    const made = new (class Lower3 extends Below3 {})(1, 2);
  });
})();
console.log(lines.join("\n"));
