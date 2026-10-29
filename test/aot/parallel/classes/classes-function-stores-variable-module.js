// `var A; var init = once(() => { A = class {} });` is what a bundler makes of the classes of a module that it wraps in a function. Until the function has run the variable holds undefined,
// and a class that extends undefined is never made: its definition throws.
const lines = [];
const say = (...all) => lines.push(all.map(String).join(" "));
const attempt = (name, run) => {
  try {
    say(name, run());
  } catch (error) {
    say(name, error.constructor.name, error.message);
  }
};
var once = (run, result) => () => (run && (result = run((run = 0))), result);

// In order.
var Base;
var initBase = once(() => {
  Base = class Base {
    a = 1;
    m() {
      return this.a;
    }
  };
});
var Derived;
var initDerived = once(() => {
  initBase();
  Derived = class Derived extends Base {
    b = 2;
  };
});
initDerived();
class Sub extends Derived {
  x = 3;
}
const sub = new Sub();
say(sub.a, sub.b, sub.x, sub.m(), sub instanceof Base, Object.keys(sub).join());
say(new Derived().b, new Base().m(), Object.getPrototypeOf(Sub) === Derived, Object.getPrototypeOf(Derived) === Base);

// Read before the function has run, and behind it.
var Late;
function initLate() {
  Late = class Late {
    k = 1;
  };
}
const belowLate = () => {
  class Early extends Late {
    e = 2;
  }
  const made = new Early();
  return made.k + made.e;
};
attempt("before", belowLate);
initLate();
attempt("behind", belowLate);

// The function runs twice: two classes out of one text.
var Twice;
function initTwice() {
  Twice = class Twice {
    t = 1;
    who() {
      return "twice";
    }
  };
}
initTwice();
const First = Twice;
class BelowFirst extends Twice {
  f = 1;
}
initTwice();
class BelowSecond extends Twice {
  g = 2;
}
say(First === Twice, new BelowFirst() instanceof First, new BelowFirst() instanceof Twice, new BelowSecond() instanceof First, new BelowSecond() instanceof Twice);
First.prototype.who = function () {
  return "first";
};
say(new BelowFirst().who(), new BelowSecond().who(), new BelowFirst().t + new BelowFirst().f, new BelowSecond().t + new BelowSecond().g);

// null is a heritage, undefined is none.
var Nothing = null;
function initNothing(really) {
  if (really)
    Nothing = class Nothing {
      n = 1;
    };
}
const belowNothing = () => {
  class Below extends Nothing {
    constructor() {
      if (Nothing) {
        super();
        this.p = 2;
        return;
      }
      return Object.create(new.target.prototype);
    }
    q() {
      return "q" + this.n + this.p;
    }
  }
  return new Below().q() + " " + (Object.getPrototypeOf(Below.prototype) === null) + " " + (Object.getPrototypeOf(Below) === Function.prototype);
};
initNothing(false);
attempt("null", belowNothing);
initNothing(true);
attempt("class", belowNothing);

// Whatever else the one store may bring.
var Odd;
function initOdd(value) {
  Odd = value;
}
for (const value of [undefined, 1, "text", Symbol.iterator, true, 10n, () => 1, {}, async function f() {}, function* g() {}, function Plain() { this.plain = 1; }, class Fine { fine = 1; }]) {
  initOdd(value);
  attempt(typeof value, () => {
    class BelowOdd extends Odd {
      o = 1;
    }
    return Object.keys(new BelowOdd()).join();
  });
}

// Another new.target.
attempt("reflect", () => {
  const made = Reflect.construct(Base, [], Sub);
  return [made.a, made.b, made.x, made instanceof Sub, made.m()].join();
});
attempt("reflect", () => {
  const made = Reflect.construct(Sub, [], Base);
  return [made.a, made.b, made.x, made instanceof Sub, made.m()].join();
});

// The link above the class is changed behind its definition.
var Moved;
function initMoved() {
  Moved = class Moved {
    v = 1;
    where() {
      return "moved";
    }
  };
}
initMoved();
class BelowMoved extends Moved {
  w = 2;
}
class Elsewhere {
  u = 3;
  where() {
    return "elsewhere";
  }
}
say(Object.keys(new BelowMoved()).join(), new BelowMoved().where());
Object.setPrototypeOf(BelowMoved, Elsewhere);
Object.setPrototypeOf(BelowMoved.prototype, Elsewhere.prototype);
say(Object.keys(new BelowMoved()).join(), new BelowMoved().where());

// Hot.
let sum = 0;
for (let i = 0; i < 20000; i++) {
  const made = new Sub();
  made.a += i & 1;
  sum += made.a + made.b + made.x + made.m();
}
say(sum);
console.log(lines.join("\n"));
