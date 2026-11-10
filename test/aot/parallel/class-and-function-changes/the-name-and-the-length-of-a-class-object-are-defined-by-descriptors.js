// What a class object answers under `name` and `length` behind a definition by descriptor, and that its objects are as before.
class Base { constructor() { this.n = 1; } get() { return this.n; } static make() { return new this(); } }
const Named = class Inner extends Base { constructor(a, b) { super(); this.m = 2; } };
console.log(Named.name, Named.length);
Object.defineProperty(Named, "name", { value: "Outer" });
Object.defineProperty(Named, "length", { value: 7 });
console.log(Named.name, Named.length, new Named().get(), new Named().m, Named.make().constructor.name, Object.keys(Named).length);
try { Named.name = "refused"; } catch (error) { console.log(error.name); }
console.log(Named.name, Object.getOwnPropertyDescriptor(Named, "name").writable, Object.getOwnPropertyDescriptor(Named, "name").configurable);

class Numbered extends Base {}
Object.defineProperty(Numbered, "name", { value: 5, writable: true });
console.log(Numbered.name + 1, typeof Numbered.name);
Numbered.name = { held: 1 };
console.log(Numbered.name.held, new Numbered().get());

class Heir extends Named {}
console.log(Heir.name, Heir.length, new Heir().m, Object.getPrototypeOf(Heir).name);

class Declares extends Base { static name = "Own"; }
Object.defineProperty(Declares, "name", { value: "Laid" });
console.log(Declares.name, new Declares().get());

class DeclaresMethod extends Base { static name() { return "called"; } }
console.log(DeclaresMethod.name());
Object.defineProperty(DeclaresMethod, "name", { value: () => "laid" });
console.log(DeclaresMethod.name(), new DeclaresMethod().get());

class BelowMethod extends DeclaresMethod {}
console.log(typeof BelowMethod.name);
Object.defineProperty(BelowMethod, "name", { value: "own" });
console.log(BelowMethod.name, new BelowMethod().get());

class Got extends Base {}
let asked = 0;
Object.defineProperty(Got, "name", { get() { asked++; return "Got" + this.length; } });
console.log(Got.name, Got.name, asked, new Got().get());

function rename(target, value) { return Object.defineProperty(target, "name", { value, configurable: true }); }
const First = rename(class extends Base {}, "First");
const Second = rename(class extends Base { static name = "kept?"; }, "Second");
console.log(First.name, Second.name, new First().get(), new Second().get());
try { Object.defineProperty(Named, "name", { value: "again" }); } catch (error) { console.log(error.name); }
console.log(Named.name);
