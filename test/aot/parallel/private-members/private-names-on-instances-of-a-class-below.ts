// An instance of a class below has the name of the class above, and a name of the same spelling of its own beside it.
class Base { #x = 1; #y: number; constructor(y: number) { this.#y = y; } sum() { return this.#x + this.#y; } bump() { this.#x++; return this; } static has(o: any) { return #x in o; } static x(o: Base) { return o.#x; } }
class Mid extends Base { #x = 10; z = 3; constructor(y: number) { super(y); } own() { return this.#x; } static has(o: any) { return #x in o; } }
class Low extends Mid { #w = "w"; w() { return this.#w; } }
const list: Base[] = [new Base(2), new Mid(3), new Low(4)];
let total = 0;
for (let round = 0; round < 4; round++) for (const o of list) total += o.bump().sum() + Base.x(o);
console.log(total);
console.log(list.map(o => Base.has(o)).join(), list.map(o => Mid.has(o)).join());
console.log((list[1] as Mid).own(), (list[2] as Low).own(), (list[2] as Low).w());
try { Mid.prototype.own.call(list[0]); } catch (e: any) { console.log(e instanceof TypeError); }
try { Low.prototype.w.call(list[1]); } catch (e: any) { console.log(e instanceof TypeError); }
console.log(Base.prototype.sum.call(list[2]));
