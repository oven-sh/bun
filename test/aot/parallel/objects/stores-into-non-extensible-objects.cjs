"use strict";
// Non-extensible and sealed objects take stores into the properties they have and reject new ones. Frozen objects reject both.
class Bench {
  constructor(mark) {
    this.width = -0;
    this.cloth = null;
    this.seats = 0;
    this.mark = mark;
    Object.preventExtensions(this);
  }
}
function Stool(mark) {
  this.width = -0;
  this.cloth = null;
  this.seats = 0;
  this.mark = mark;
  Object.preventExtensions(this);
}
class Open {
  constructor(mark) {
    this.mark = mark;
    this.seats = 0;
    this.cloth = null;
    this.width = -0;
  }
}
function literal(mark) {
  return { mark, seats: 0, cloth: null, width: -0 };
}
const said = [];
function attempt(name, f) {
  try {
    const answer = f();
    said.push(name + " " + String(answer));
  } catch (error) {
    said.push(name + " " + error.constructor.name);
  }
}
function overwrite(o, seats, cloth) {
  o.seats = seats;
  o.cloth = cloth;
  o.width = seats + 0.5;
  o.seats |= 1;
  return o.seats + o.width;
}
function create(o, value) {
  o.late = value;
  return o.late;
}
function both(o, value) {
  o.seats = value;
  o.late = value;
  o.cloth = value;
  return o.seats;
}
function loop(o, count) {
  for (let i = 0; i < count; i++) {
    o.seats += i;
    o.width = i;
  }
  return o.seats + ":" + o.width;
}
function change(o, level) {
  o.seats = 1;
  level(o);
  o.seats = 2;
  return o.seats;
}
class Fields extends (function (o) { return o; }) {
  seats = 9;
}
class NewField extends (function (o) { return o; }) {
  late = 9;
}
const levels = { none: o => o, prevent: Object.preventExtensions, seal: Object.seal, freeze: Object.freeze };
const makers = { Bench: t => new Bench(t), Stool: t => new Stool(t), Open: t => new Open(t), literal };
for (const [m, make] of Object.entries(makers)) {
  for (const [l, level] of Object.entries(levels)) {
    const fresh = () => level(make(3));
    const name = m + " " + l + " ";
    attempt(name + "overwrite", () => overwrite(fresh(), 4, fresh()));
    attempt(name + "create", () => create(fresh(), 4));
    attempt(name + "both", () => both(fresh(), 4));
    attempt(name + "loop", () => loop(fresh(), 5));
    attempt(name + "change", () => change(make(1), level));
    attempt(name + "field", () => new Fields(fresh()).seats);
    attempt(name + "new field", () => new NewField(fresh()).late);
    attempt(name + "descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(new Fields(fresh()), "seats")));
    attempt(name + "define", () => Object.defineProperty(fresh(), "seats", { value: 8 }).seats);
    attempt(name + "assign", () => Object.assign(fresh(), { seats: 6, cloth: 7 }).seats);
    attempt(name + "assign new", () => Object.assign(fresh(), { seats: 6, other: 7 }).other);
    attempt(name + "delete", () => delete fresh().seats);
    attempt(name + "again", () => {
      const o = make(2);
      delete o.cloth;
      level(o);
      o.seats = 5;
      o.cloth = 1;
      return o.cloth;
    });
    attempt(name + "levels", () => [Object.isExtensible(fresh()), Object.isSealed(fresh()), Object.isFrozen(fresh())]);
  }
}
for (let i = 0; i < said.length; i += 4) console.log(said.slice(i, i + 4).join(" . "));
