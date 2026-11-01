// Flags: --aot-check=verify-each-pass
// `(...args) => this.method(first, ...args)`: the list of the rest parameter is handed on as the callee's own where nobody else has seen it. Every form makes one thing about that list unusual.
function line(name, run) { let answer; try { answer = run(); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 50); } console.log(name + ": " + (typeof answer === "string" ? answer : JSON.stringify(answer))); }
const describe = rest => [rest.length, Object.keys(rest).join(), 0 in rest, 1 in rest, Array.isArray(rest), rest.map(each => each === undefined ? "u" : each).join("|")].join(" ");

class Logger {
  constructor() {
    this.kept = [];
    this.plain = (...args) => this.take("P", ...args);
    this.twice = (...args) => this.take("T", ...args);
    this.hole = (...args) => { delete args[1]; return this.take("H", ...args); };
    this.grown = (...args) => { args.length = 4; return this.take("G", ...args); };
    this.cut = (...args) => { args.length = 1; return this.take("C", ...args); };
    this.fraction = (...args) => { args[0] = 1.5; return this.take("F", ...args); };
    this.named = (...args) => { args.extra = 1; return this.take("N", ...args); };
    this.ownIterator = (...args) => { args[Symbol.iterator] = function* () { yield "own"; }; return this.take("I", ...args); };
    this.accessor = (...args) => { Object.defineProperty(args, 0, { get() { return "got"; }, enumerable: true, configurable: true }); return this.take("A", ...args); };
    this.frozen = (...args) => { Object.freeze(args); return this.change("Z", ...args); };
    this.popFirst = (...args) => this.take(args.pop(), ...args);
    this.pushFirst = (...args) => this.take(args.push("pushed"), ...args);
    this.emptyFirst = (...args) => this.take((args.length = 0, "E"), ...args);
    this.usedAfter = (...args) => { const answer = this.change("U", ...args); return answer + " / " + describe(args); };
    this.returned = (...args) => { this.keep("R", ...args); return args; };
    this.twoSpreads = (...args) => this.take("2", ...args, ...args);
    this.spreadThenMore = (...args) => this.take("M", ...args, "last");
    this.noFirst = (...args) => this.takeAll(...args);
    this.intoFixed = (...args) => this.fixed("X", ...args);
    this.captured = (...args) => { const peek = () => args.length; const answer = this.change("K", ...args); return answer + " / " + peek(); };
    this.getterMember = (...args) => { this.pending = args; return this.viaGetter("V", ...args); };
  }
  take(first, ...rest) { return first + " " + describe(rest); }
  takeAll(...rest) { return describe(rest); }
  fixed(first, a, b, ...rest) { return [first, a, b, describe(rest)].join(" "); }
  change(first, ...rest) { try { rest.push("more"); rest[0] = "changed"; } catch (error) { return first + " " + error.name; } return first + " " + describe(rest); }
  keep(first, ...rest) { this.kept.push(rest); return first; }
  get viaGetter() { this.pending.push("by the getter"); return this.take; }
}

const logger = new Logger();
line("plain", () => logger.plain(1, 2, 3));
line("empty", () => logger.plain());
line("undefined in it", () => logger.plain(undefined, 2));
line("two sites, first", () => logger.twice(1));
line("two sites, second", () => logger.twice("a", "b"));
line("a hole", () => logger.hole(1, 2, 3));
line("grown", () => logger.grown(1, 2));
line("cut", () => logger.cut(1, 2, 3));
line("a fraction", () => logger.fraction(1, 2));
line("a name of its own", () => logger.named(1, 2));
line("an iterator of its own", () => logger.ownIterator(1, 2));
line("an accessor", () => logger.accessor(1, 2));
line("frozen", () => logger.frozen(1, 2));
line("popped in the first argument", () => logger.popFirst(1, 2, 3));
line("pushed in the first argument", () => logger.pushFirst(1, 2));
line("emptied in the first argument", () => logger.emptyFirst(1, 2));
line("used after the call", () => logger.usedAfter(1, 2));
line("returned, and the callee keeps its own", () => { const mine = logger.returned(1, 2); return [mine === logger.kept[0], describe(mine), describe(logger.kept[0])]; });
line("spread twice", () => logger.twoSpreads(1, 2));
line("more behind the spread", () => logger.spreadThenMore(1, 2));
line("nothing in front", () => logger.noFirst(1, 2));
line("into written parameters", () => logger.intoFixed(1, 2, 3, 4));
line("into written parameters, too few", () => logger.intoFixed(1));
line("captured by a closure", () => logger.captured(1, 2));
line("the member is a getter that changes the list", () => logger.getterMember(1, 2));
const long = Array.from({ length: 70000 }, (_, index) => index);
line("very long", () => { const text = logger.plain(...long); return text.slice(0, 12) + " " + text.length; });
line("at the limit", () => { const text = logger.plain(...long.slice(0, 65534)); return text.slice(0, 12) + " " + text.length; });
line("one past the limit", () => { const text = logger.plain(...long.slice(0, 65535)); return text.slice(0, 12) + " " + text.length; });
line("holes handed in by the caller", () => logger.plain(...[1, , 3]));
line("a function with its own this", () => { const own = { take(first, ...rest) { return first + " " + describe(rest); }, go(...args) { return this.take("O", ...args); } }; return own.go(1, 2); });
line("a static method", () => { class S { static take(first, ...rest) { return first + " " + describe(rest); } static go(...args) { return this.take("S", ...args); } } return S.go(1, 2); });
line("super's method", () => { class A { take(first, ...rest) { return first + " " + describe(rest); } } class B extends A { go(...args) { return super.take("B", ...args); } } return new B().go(1, 2); });
line("an async arrow", () => { let seen = "pending"; const own = { take(first, ...rest) { return first + " " + describe(rest); } }; const go = async (...args) => own.take("Y", ...args); go(1, 2).then(value => console.log("  later: " + value)); return seen; });
line("a generator", () => { const own = { take(first, ...rest) { return first + " " + describe(rest); } }; function* go(...args) { yield own.take("*", ...args); args.push(9); yield own.take("*", ...args); } return [...go(1, 2)]; });
