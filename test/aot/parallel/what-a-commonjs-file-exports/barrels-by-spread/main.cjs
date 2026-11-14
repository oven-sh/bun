// `module.exports = { ...require("./a"), other }` and `module.exports = Object.assign({}, require("./a"))`: the names of what is spread are exports of the file, as they are when it is evaluated.
// STATISTIC: ImportedFunctionReadsHoisted >= 1
"use strict";
const all = require("./modules/index-spread.cjs"), assigned = require("./modules/index-assign.cjs"), nested = require("./modules/index-nested.cjs");
const named = require("./modules/index-named.cjs"), marked = require("./modules/index-marked.cjs"), getters = require("./modules/index-getters.cjs");
const shown = require("./modules/index-shown.cjs"), sometimes = require("./modules/index-sometimes.cjs"), cycle = require("./modules/cycle-a.cjs"), mixed = require("./modules/index-mixed.cjs");

// Barrels that nobody looks at as a whole.
const figures = require("./modules/index-figures.cjs"), { Figure, scale: scaleAssigned, name: nameAssigned, step } = require("./modules/index-figures-assigned.cjs"), deep = require("./modules/index-figures-nested.cjs"), held = require("./modules/index-figures-held.cjs");
class Cube extends figures.Figure { constructor(size) { super("cube", size); this.depth = size; } volume() { return this.area() * this.depth; } }
class Slab extends deep.Figure { constructor(size) { super("slab", size); this.depth = 1; } }
class Tile extends Figure { constructor(size) { super("tile", size); this.color = "red"; } }
let volume = 0;
for (let i = 0; i < 400; i++) { volume += new Cube(i % 7).volume() + new Slab(i % 5).area() + new Tile(i % 3).area() + new figures.Figure("f", i & 3).area() + figures.scale(i, 3) + scaleAssigned(i, 4) + deep.scale(i, 5); volume |= 0; }
console.log(volume, new Cube(2) instanceof deep.Figure, figures.Figure === Figure, deep.Figure.name, figures.scale === scaleAssigned);
console.log(held.scaled(5), held.name, new held.Figure("h", 3).area(), held.Figure === Figure, held.steps);
console.log(figures.scaleOf, figures.name, nameAssigned, deep.name, deep.own, figures.steps, step(), figures.step(), figures.steps, deep.steps);

class Solid extends all.Shape { constructor(size) { super("solid", size); this.depth = size * 2; } volume() { return this.area() * this.depth; } }
class Flat extends nested.Shape { constructor(size) { super("flat", size); } }
let sum = 0;
for (let i = 0; i < 400; i++) { sum += new Solid(i % 7).volume() + new Flat(i % 5).area() + new assigned.Shape("x", i % 3).area() + all.mix(i, 3) + assigned.mix(i, 4) + nested.mix(i, 5); sum |= 0; }
console.log(sum, new Solid(2) instanceof nested.Shape, all.Shape === assigned.Shape, nested.Shape.name, all.mix === nested.mix);

// The order of the names, and which of two values under one name stays.
for (const it of [all, assigned, nested, named, mixed]) console.log(Object.keys(it).join());
console.log(all.missing, all.over, assigned.over, nested.over, mixed.over, named.over, all.own, assigned.own);

// The value is the one of the time when the literal was evaluated.
console.log(all.count, all.bump(), all.bump(), all.count, require("./modules/source.cjs").count, assigned.count);
require("./modules/source.cjs").count = "stored"; console.log(all.count, nested.count, require("./modules/source.cjs").count);
all.count = "of the barrel"; console.log(all.count, nested.count, require("./modules/source.cjs").count);

// __esModule: hidden it is not spread, plain it is. `default` is a name as another.
console.log(marked.__esModule, typeof marked.default, "__esModule" in all, all.__esModule, Object.keys(marked).join());
// Getters are asked once, when they are spread; what loops do not see is not spread.
console.log(getters.live, getters.advance(), getters.live, getters.hidden, "hidden" in getters, JSON.stringify(Object.getOwnPropertyDescriptor(getters, "live")));
// Seen as a whole: an ordinary object.
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(shown, "over")), Object.entries(shown).map(([k, v]) => k + ":" + typeof v).join(), shown.later);
delete shown.over; console.log("over" in shown, shown.over, require("./modules/source.cjs").over);
// Names that a source may have or not, and names that it gets later.
console.log(Object.keys(sometimes).join(), sometimes.maybe, sometimes.added);
console.log(cycle.fromA, cycle.fromB, cycle.seenByB);
console.log(mixed.deep.one, mixed.two, mixed.three(), typeof mixed.Shape, [...mixed.list].join());
