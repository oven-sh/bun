// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. The method is called on an heir, on an object of another making, on a box whose field is a getter and on nothing.
class Box { constructor(items) { this.items = items; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) s += this.items[i]; return s; } }
const name = JSON.parse('"sum"');
class Heir extends Box { constructor(items) { super(items); this.more = 1; } }
const key = JSON.parse('"items"'), sum = Box.prototype[name];
let asked = 0;
const withGetter = Object.defineProperty(Object.create(Box.prototype), key, { get() { asked++; return [1.5, 2.5]; } });
for (let turn = 0; turn < 3; turn++) console.log(new Box([0.5, 1.5])[name](), new Heir([2.5, 3.5])[name](), sum.call(Object.fromEntries([[key, [4.5]]])), withGetter[name](), asked, sum.call(Object.fromEntries([[key, new Uint8Array([7, 7])]])), sum.call(Object.fromEntries([[key, "ab"]])));
for (const other of [null, undefined, 5, Object.create(null)]) { try { console.log(sum.call(other)); } catch (error) { console.log(error instanceof TypeError); } }
