// A constructor above lets `this` go to a coroutine that it starts; the heir writes the field again behind super(), by a field of its own and by a store. Link calls that store part of the construction. The coroutine sleeps over it and reads the other list when it wakes.
const out = [];
{ class Base { items = [1.5, 2.5]; done = this.slowly(); async slowly() { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]; await null; } return s; } }
  class Heir extends Base { items = [10.5, 20.5, 30.5]; }
  out.push(await new Heir().done, await new Base().done); }
{ class Base { constructor() { this.items = [1.5, 2.5]; this.done = this.slowly(); } async slowly() { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]; await null; } return s; } }
  class Heir extends Base { constructor() { super(); this.items = [10.5, 20.5, 30.5]; } }
  out.push(await new Heir().done, await new Base().done); }
{ class Base { items = [1.5, 2.5]; it = this.steps(); first = this.it.next().value; *steps() { for (let i = 0; i < this.items.length; i++) yield this.items[i]; } }
  class Heir extends Base { items = [10.5, 20.5, 30.5]; }
  const h = new Heir(); out.push(h.first, [...h.it].join()); }
{ class Base { width = 2; done = this.slowly(); async slowly() { let s = 0; for (let i = 0; i < 3; i++) { s += this.width * 10; await null; } return s; } }
  class Heir extends Base { width = 7; }
  out.push(await new Heir().done, await new Base().done); }
console.log(out.join("|"));
