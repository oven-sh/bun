// A mixin with private members is applied twice, and the instance belongs to a class below both applications. Each application adds its own private names to the instance.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
class A { a = 1; }

const belowField = Base => class extends Base { also = "also"; };
function withField(Base) { return class extends Base { #hidden = 1; static has(o) { return #hidden in o; } }; }
console.log(Object.keys(new (belowField(withField(withField(A))))()).join());

const belowMethod = Base => class extends Base { also = "also"; };
function withMethod(Base) { return class extends Base { #m() { return 1; } get #g() { return 2; } sum() { return this.#m() + this.#g; } }; }
console.log(new (belowMethod(withMethod(withMethod(A))))().sum());

const below = Base => class extends Base { also = "also"; };
const lowest = Base => class extends Base { more = "more"; };
function twoBelow(Base) { return class extends Base { #hidden = 1; reads() { return this.#hidden; } }; }
const deep = new (lowest(below(twoBelow(twoBelow(A)))))();
console.log(Object.keys(deep).join(), deep.reads());

const also = Base => class extends Base { also = "also"; };
function counted(Base) {
  return class extends Base {
    #count = 1;
    reads() { return this.#count; }
    bump(by) { return (this.#count += by); }
    static has(o) { return #count in o; }
  };
}
const Inner = counted(A), Outer = counted(Inner), Top = also(Outer), Low = also(Inner);
const top = new Top(), low = new Low();
Inner.prototype.bump.call(top, 10);
Outer.prototype.bump.call(top, 100);
console.log(Inner.has(top), Outer.has(top), Inner.has(low), Outer.has(low));
console.log(Inner.prototype.reads.call(top), Outer.prototype.reads.call(top), top.reads(), low.reads());
try { Outer.prototype.reads.call(low); } catch (error) { console.log(error.constructor.name); }
console.log(Object.keys(top).join(), JSON.stringify(top), Reflect.ownKeys(top).length);
