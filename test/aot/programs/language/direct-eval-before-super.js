// A direct eval is handed `this` of the function around it. In the constructor of a derived class there is none until super() has returned, and an eval ahead of it runs all the same.
class Base { constructor() { this.id = "base"; } }
function row(name, run) { try { console.log(name + ": " + String(run())); } catch (error) { console.log(name + ": THROWS " + error.name); } }
row("ahead of super()", () => new (class extends Base { constructor() { const seen = eval("1 + 1"); super(); this.seen = seen; } })().seen);
row("a variable of the eval's own", () => new (class extends Base { constructor() { eval("var x = 20"); super(); this.seen = typeof x; } })().seen);
row("a variable of the constructor", () => new (class extends Base { constructor(given) { const seen = eval("given + 1"); super(); this.seen = seen; } })(1).seen);
row("in an arrow function ahead of super()", () => new (class extends Base { constructor() { const run = () => eval("2"); const seen = run(); super(); this.seen = seen; } })().seen);
row("behind super()", () => new (class extends Base { constructor() { super(); this.seen = eval("this.id"); } })().seen);
row("in an arrow function made ahead of super() and called behind it", () => new (class extends Base { constructor() { const run = () => eval("this.id"); super(); this.seen = run(); } })().seen);
row("a class that extends nothing", () => new (class { constructor() { this.id = "own"; this.seen = eval("this.id"); } })().seen);
row("no super() at all", () => new (class extends Base { constructor() { eval("1"); } })());
