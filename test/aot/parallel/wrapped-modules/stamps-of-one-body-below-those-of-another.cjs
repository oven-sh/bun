// The bodies of a bundle that hold classes: a class of one body extends what another body exports, whole, under a name, or by a getter; its instances have the fields of both. Bodies that export something else later, that run late, that export no class.
'use strict';
var later = (body, held) => () => (held || body((held = { exports: {} }).exports, held), held.exports);
var order = [];
var require_stamp = later((exports, module) => {
  order.push('stamp');
  class Stamp { constructor(cents) { this.cents = cents; this.marks = []; this.torn = false; } mark(town) { this.marks.push(town); return this; } get worth() { return this.torn ? 0 : this.cents; } tear() { this.torn = true; return this.kind(); } kind() { return 'stamp'; } static of(list) { return list.map(c => new this(c)); } }
  Stamp.printed = 3; module.exports = Stamp;
});
var require_air = later((exports) => {
  order.push('air');
  var Stamp = require_stamp();
  class Air extends Stamp { constructor(cents, route) { super(cents); this.route = route; this.miles = 0; } fly(n) { this.miles += n; if (n > 90) this.mark('far'); return this.miles; } get worth() { return super.worth + (this.miles > 100 ? 5 : 1); } kind() { return 'air ' + super.kind(); } }
  exports.Air = Air; exports.Sheet = class extends Stamp { constructor(...all) { super(all.length); this.all = all; } get worth() { return this.all.reduce((sum, s) => sum + s.worth, 0); } };
  Object.defineProperty(exports, 'Late', { enumerable: true, get: () => require_late().Late });
});
var require_late = later((exports, module) => { order.push('late'); var { Air } = require_air(); exports.Late = class Late extends Air { constructor(route) { super(2, route); this.due = 4; } get worth() { return this.due - super.worth; } }; exports.loose = function Loose(cents) { require_stamp().prototype.kind.call(this); this.cents = cents; }; });
var require_desk = later((exports, module) => {
  order.push('desk');
  const { Air, Sheet } = require_air(), air = require_air(), Stamp = require_stamp();
  module.exports = { sum(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].worth; return sum; }, send(list, n) { for (const s of list) { if (s instanceof Air) s.fly(n); s.mark('t' + n); } return list.length; }, make: n => [new Stamp(n), new Air(n + 1, 'east'), new Sheet(new Stamp(1), new Air(2, 'x')), new air.Late('w' + n)] };
});
var told = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };
console.log(order.join(), told(() => require_desk().make(4).map(s => s.worth).join()), order.join());
var desk = require_desk(); for (var k = 0; k < 120; k++) { var list = desk.make(k % 9); desk.send(list, k); desk.sum(list); }
var mine = desk.make(7); console.log(desk.send(mine, 95), desk.sum(mine), mine.map(s => Object.keys(s).join('')).join(' '), mine.map(s => s.kind()).join(), mine.map(s => s.marks.join('')).join('/'), mine[1].tear(), desk.sum(mine), mine[3] instanceof require_stamp(), require_air().Air.of([1, 2]).map(s => s.worth).join(), require_late().Late.printed);
var odd = [{ worth: 5, mark() {} }, Object.create(mine[1]), new Proxy(mine[0], {}), { get worth() { return '9'; }, mark() { this.seen = 1; } }]; console.log(told(() => desk.send(odd, 2)), told(() => desk.sum(odd)), told(() => desk.sum([null])), told(() => desk.send([{}], 1)));
require_air().Air.prototype.kind = () => 'other'; Object.defineProperty(require_stamp().prototype, 'worth', { get() { return this.cents * 10; } }); console.log(mine.map(s => s.kind()).join(), desk.sum(mine)); Object.setPrototypeOf(require_air().Air.prototype, { mark() { return 'lost'; } }); console.log(told(() => desk.sum(mine)), told(() => desk.send(mine, 1)), told(() => new (require_air().Air)(3, 'n').cents), mine[1] instanceof require_stamp());
var require_wrong = later((exports, module) => { module.exports = class extends require_desk() {}; }), require_none = later((exports, module) => { module.exports = class extends (require_stamp().none) {}; }), require_swap = later((exports, module) => { exports.A = class extends require_stamp() { x = this.cents; }; module.exports = { A: class B extends exports.A { y = this.x + 1; } }; }); console.log(told(() => require_wrong()), told(() => require_none()), told(() => JSON.stringify(new (require_swap().A)(6))), require_swap().A.name, told(() => Reflect.construct(require_late().loose, [4]).cents));
