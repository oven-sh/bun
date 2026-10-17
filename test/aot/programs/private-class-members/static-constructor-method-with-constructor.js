// A class with both a constructor and a static method named `constructor`: `new` runs the real constructor.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
let calls = 0;
class Both { constructor(v) { this.made = v; } static constructor() { calls++; return "static"; } }
class Alone { static constructor() { calls++; return "alone"; } }
class Async { constructor() { this.made = 1; } static async constructor() { return "later"; } }
class Quoted { constructor() { this.made = 2; } static "constructor"() { return "quoted"; } }
class Heir extends Both { static constructor() { return "heir " + super.constructor(); } }
row("new runs the constructor", () => new Both(5).made + " " + calls);
row("the static method", () => Both.constructor() + " " + calls);
row("it is the class's own property", () => Object.hasOwn(Both, "constructor") + " " + Object.hasOwn(Alone, "constructor"));
row("the prototype's constructor is the class", () => (Both.prototype.constructor === Both) + " " + (Alone.prototype.constructor === Alone));
row("new of a class that has only the static one", () => Object.keys(new Alone()).length + " " + calls + " " + (new Alone() instanceof Alone));
row("the static one alone", () => Alone.constructor() + " " + calls);
row("it cannot be constructed", () => new Both.constructor());
row("its name and length", () => Both.constructor.name + " " + Both.constructor.length + " " + Both.length);
row("async", () => new Async().made + " " + typeof Async.constructor().then);
row("quoted", () => new Quoted().made + " " + Quoted.constructor());
row("an heir", () => Heir.constructor() + " " + new Heir(6).made);
function make(n) { return class { constructor() { this.n = n; } static constructor() { return -n; } }; }
row("made twice", () => [new (make(1))().n, make(1).constructor(), new (make(2))().n, make(2).constructor(), make(1).constructor === make(1).constructor].join());
