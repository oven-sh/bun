// A variable that a function reads, stores and reads again: each read gives what the variable holds then.
function show(value: any): string {
  return value && typeof value === "object" ? Object.keys(value).map(key => key + ":" + show(value[key])).join() : String(value);
}

class Step {
  x: any;
  n: any;
  constructor(x: any, n: any) {
    this.x = x;
    this.n = n;
  }
  copy() {
    return new Step(this.x, this.n + 1);
  }
}
class Wide {
  first = "first";
  n = 40;
  x = "wide";
}

let top: any = new Step("top", 0);
const other: any = new Step("other", 10);

function replacedByCall() {
  const t = top.x;
  let c = 0;
  top = top.copy();
  if (top.n > 2) c += 3;
  return t + c + top.n;
}
function replacedByParameter(given: any) {
  const t = top.x;
  top = given;
  return t + top.n + top.x;
}
function replacedByAnother() {
  const t = top.x;
  top = other;
  return t + top.n + top.x;
}
function replacedAndBack() {
  const kept = top;
  const t = top.n;
  top = other;
  const u = top.n;
  top = kept;
  return t + u + top.n;
}
function setTop(value: any) {
  top = value;
}
function replacedInCallee(given: any) {
  const t = top.n;
  setTop(given);
  return t + top.n;
}
function replacedInGetter(given: any) {
  const t = top.n;
  const u = given.swap;
  return t + u + top.n;
}
function notReplaced(given: any) {
  const t = top.n;
  given.k = t;
  return t + top.n + given.k + top.x;
}

function holder() {
  let state: any = new Step(null, 0);
  let total: any = 1;
  return {
    get state() {
      return state;
    },
    go() {
      const t = state.x;
      let c = 0;
      state = state.copy();
      if (state.n > 2) c += 3;
      return [t, c, state.n];
    },
    put(given: any) {
      const t = state.n;
      state = given;
      return t + state.n + state.x;
    },
    count(given: any) {
      const t = state.n + total;
      total = given;
      return t + total * 2;
    },
    text(given: any) {
      const t = state.n + total;
      total = given;
      return t + total + total;
    },
  };
}

const lines: any[] = [];
const swapping = {
  get swap() {
    top = new Wide();
    return 1000;
  },
};
const object = holder();
function run() {
  for (let i = 0; i < 6; i++) {
    lines.push(replacedByCall());
    lines.push(replacedByParameter(i & 1 ? new Wide() : new Step("s" + i, i)));
    lines.push(replacedByAnother());
    lines.push(replacedByParameter({ n: "text" + i, x: i }));
    lines.push(replacedAndBack());
    lines.push(replacedInCallee(i & 1 ? new Wide() : new Step("c", i * 3)));
    lines.push(replacedInGetter(i & 1 ? swapping : { swap: 7 }));
    lines.push(notReplaced(i & 1 ? new Wide() : {}));
    top = new Step("again", i);
    lines.push(show(object.go()), show(object.state));
    lines.push(object.put(i & 1 ? new Wide() : new Step("p", i)));
    lines.push(object.count(i), object.text(i & 1 ? "t" : i));
    object.put(new Step("q", i));
    object.count(0);
  }
}
run();

(function () {
  class State {
    x: any;
    n: any;
    constructor(x: any) {
      this.x = x;
      this.n = 0;
    }
    clone() {
      return new State(this.x);
    }
  }
  function make() {
    let state: any = new State(null);
    return {
      get state() {
        return state;
      },
      go() {
        const t = state.x;
        let c = 0;
        state = state.clone();
        if (state.n > 2) c += 3;
        return [t, c];
      },
    };
  }
  const made = make();
  function runMade() {
    for (let i = 0; i < 5; i++) lines.push(show(made.go()));
  }
  runMade();
  lines.push(show(made.state));
})();
console.log(lines.join("\n"));
