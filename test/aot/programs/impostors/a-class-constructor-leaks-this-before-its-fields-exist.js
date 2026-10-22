function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

const seen = [];
let observer = null;
function leak(thing) {
  globalThis[["leaked", "Thing"].join("")] = thing;
}

function titleOf(thing) {
  return thing.title;
}

function pagesOf(thing) {
  return thing.pages;
}

function summaryOf(thing) {
  return thing.summary();
}

function glance(when, thing) {
  let summary;
  try {
    summary = summaryOf(thing);
  } catch (error) {
    summary = error.constructor.name;
  }
  seen.push(when + ": " + show(thing) + " title " + show(titleOf(thing)) + " pages " + show(pagesOf(thing)) + " summary " + show(summary));
}

class Stored {
  constructor(title, pages) {
    if (observer) observer("at the start", this);
    this.title = title;
    if (observer) observer("after title", this);
    if (pages < 0) throw new RangeError("negative");
    this.pages = pages;
    if (observer) observer("at the end", this);
  }
  summary() {
    return this.title + ", " + this.pages + " pages";
  }
}

class WithFields {
  title = (observer && observer("in the first initializer", this), "field title");
  pages = (observer && observer("in the second initializer", this), 10);
  constructor() {
    if (observer) observer("in the constructor", this);
  }
  summary() {
    return this.title + ", " + this.pages + " pages";
  }
}

class Base {
  constructor() {
    this.setup();
    if (observer) observer("at the end of the base constructor", this);
  }
  setup() {
    this.title = "base title";
  }
  summary() {
    return this.title + ", " + this.pages + " pages";
  }
}

class Derived extends Base {
  title = "initializer title";
  pages = 20;
  setup() {
    if (observer) observer("in the overridden setup", this);
    this.pages = "pages from setup";
    this.extra = "extra from setup";
    this.title = "title from setup";
  }
}

class DerivedStores extends Base {
  constructor() {
    super();
    this.pages = 30;
  }
  setup() {
    this.early = this.pages;
    this.title = "title from setup";
  }
}

const makers = [
  ["stores in the constructor", () => new Stored("stored title", 5)],
  ["class fields", () => new WithFields()],
  ["a base constructor calls an overridden method, fields", () => new Derived()],
  ["a base constructor calls an overridden method, stores", () => new DerivedStores()],
];

for (let i = 0; i < 2000; i++) for (const [, make] of makers) summaryOf(make()), titleOf(make()), pagesOf(make());

for (const [label, make] of makers) {
  attempt(label + ": finished", make);
  attempt(label + ": summary()", () => summaryOf(make()));

  observer = glance;
  attempt(label + ": looked at while it is made", make);
  observer = null;
  for (const line of seen.splice(0)) console.log("  " + line);

  observer = (when, thing) => leak(thing);
  attempt(label + ": leaked through the global object", () => make() === globalThis.leakedThing);
  observer = null;
  delete globalThis.leakedThing;

  let count = 0;
  observer = (when, thing) => { if (count++ === 0) thing.pages = "stored by the observer"; };
  attempt(label + ": the observer stores pages first", make);
  count = 0;
  observer = (when, thing) => { if (count++ === 0) Object.defineProperty(thing, "title", { get: () => "the observer's getter", set() {}, configurable: true, enumerable: true }); };
  attempt(label + ": the observer defines title as an accessor first", make);
  count = 0;
  observer = (when, thing) => { if (count++ === 0) Object.preventExtensions(thing); };
  attempt(label + ": the observer closes it first", make);
  count = 0;
  observer = (when, thing) => { if (count++ === 0) Object.setPrototypeOf(thing, { summary: () => "the observer's summary" }); };
  attempt(label + ": the observer moves it first", () => summaryOf(make()));
  observer = null;
  attempt(label + ": honest again", () => summaryOf(make()));
}

let half;
observer = (when, thing) => { half = thing; };
attempt("a constructor that throws halfway", () => new Stored("half", -1));
observer = null;
attempt("the half-made object", () => half);
attempt("its pages", () => pagesOf(half));
attempt("its summary()", () => summaryOf(half));
attempt("instanceof", () => half instanceof Stored);

class ReadsBeforeSuper extends Base {
  constructor(early) {
    if (early) titleOf(this);
    super();
  }
}
attempt("this before super()", () => new ReadsBeforeSuper(true));
attempt("without the early read", () => titleOf(new ReadsBeforeSuper(false)));

class ReadsOwnField {
  first = this.second;
  second = "second";
  third = this.second;
}
attempt("a field that reads a later field", () => new ReadsOwnField());
