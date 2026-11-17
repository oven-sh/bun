// delete() of a map of cookies reads `name`, `domain` and `path` off its options and converts what the last two hold: getters, conversions and traps of the program run.
const unseen = x => [x][JSON.parse("0")];
const say = (label, answer) => {
  let work = 0;
  for (let k = 0; k < 2; k++) work = (work + k) | 0;
  console.log("ran " + label);
  return answer;
};
const attempt = (label, run) => {
  try {
    run();
    console.log(label + ": done");
  } catch (e) {
    console.log(label + ": " + e.name + ": " + e.message);
  }
};
const map = new Bun.CookieMap("a=1; b=2; c=3; d=4; e=5; f=6; g=7; h=8; i=9; j=10; k=11; l=12; Heir=13");
class Inherited {
  get name() {
    return say("inherited name", "b");
  }
  get path() {
    return say("inherited path", "/made");
  }
}
class Heir {
  static get domain() {
    return say("static domain", "made.up");
  }
}
class Computed {
  get [unseen("path")]() {
    return say("computed path", "/computed");
  }
}
const laid = { name: "d", domain: "first.up" };
Object.defineProperty(laid, "domain", {
  get() {
    return say("laid domain", "laid.up");
  },
});
const traps = new Proxy(
  {},
  {
    has(target, key) {
      return say("has " + key, key !== "domain");
    },
    get(target, key) {
      return say("get " + key, key === "name" ? "f" : "/trapped");
    },
  },
);
attempt("own getter", () =>
  map.delete({
    name: "a",
    get domain() {
      return say("own domain", "own.up");
    },
  }),
);
attempt("inherited", () => map.delete(new Inherited()));
attempt("conversions", () =>
  map.delete("c", {
    domain: {
      toString() {
        return say("toString", "text.up");
      },
    },
    path: {
      toString: null,
      valueOf() {
        return say("valueOf", "/value");
      },
    },
  }),
);
attempt("laid", () => map.delete(laid));
attempt("writer", () => {
  const bag = {
    name: "e",
    seen: 0,
    get path() {
      this.seen = 1;
      return say("path that writes", "/wrote");
    },
  };
  map.delete(bag);
  console.log(bag.seen);
});
attempt("proxy", () => map.delete(traps));
attempt("symbol key", () =>
  map.delete("g", {
    path: {
      [Symbol.toPrimitive](hint) {
        return say("toPrimitive " + hint, "/hinted");
      },
    },
  }),
);
attempt("answered object", () =>
  map.delete("h", {
    get path() {
      return {
        toString() {
          return say("toString of what a getter answers", "/answered");
        },
      };
    },
  }),
);
attempt("above", () =>
  map.delete(
    "i",
    Object.create({
      get path() {
        return say("path above", "/above");
      },
    }),
  ),
);
attempt("class", () => map.delete(Heir));
attempt("computed", () => map.delete("l", new Computed()));
attempt("unknown first", () =>
  map.delete(
    unseen({
      get name() {
        return say("name behind unseen", "j");
      },
    }),
  ),
);
attempt("String object", () => map.delete(new String("a")));
attempt("symbol", () => map.delete(Symbol("made")));
attempt("text", () => map.delete("a", "text"));
attempt("third operand", () =>
  map.delete(
    "k",
    {},
    {
      get path() {
        return say("NEVER", "/never");
      },
    },
  ),
);
console.log(map.toSetCookieHeaders().join(" | "));
