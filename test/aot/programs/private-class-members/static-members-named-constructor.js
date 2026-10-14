// Static members named `constructor`: methods, generators, async methods and accessors.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
class G { static *constructor() { yield 1; yield 2; } }
class AG { static async *constructor() { yield 1; } }
class AM { static async constructor() { return 3; } }
class M { static constructor() { return 4; } }
let stored = 0;
class Acc { static get constructor() { return 5; } static set constructor(v) { stored = v; } }
class Get { static get constructor() { return 6; } }
class Both { constructor() { this.made = 7; } static *constructor() { yield 8; } }
row("a generator", () => [...G.constructor()].join() + " " + Object.getOwnPropertyNames(G).includes("constructor"));
row("an async generator", () => typeof AG.constructor().next);
row("an async method", () => typeof AM.constructor().then);
row("a method", () => M.constructor() + " " + (new M().constructor === M));
row("accessors", () => { Acc.constructor = 9; return Acc.constructor + " " + stored; });
row("a getter alone", () => Get.constructor + " " + (new Get().constructor === Get));
row("beside the constructor", () => new Both().made + " " + [...Both.constructor()].join() + " " + (Both.prototype.constructor === Both));
row("in an expression", () => [...(class { static *constructor() { yield "e"; } }).constructor()].join());
function make(n) { return class { static *constructor() { yield n; } static get [("con" + "structor2")]() { return n; } }; }
row("made twice", () => [...make(1).constructor()].join() + [...make(2).constructor()].join() + " " + (make(1).constructor === make(1).constructor));
