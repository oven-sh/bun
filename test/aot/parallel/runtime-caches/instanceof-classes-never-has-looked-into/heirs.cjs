"use strict";
const bases = require("./bases.cjs");
let mark;
class Heir extends bases.Base {
  static #hidden = (mark = "marked");
  static count = 0;
}
class HeirOfHeir extends Heir {}
class BelowJudged extends bases.Judged {}
class Alone {}
function Plain() {}
Plain.prototype = Object.create(bases.Base.prototype);
for (const [name, value] of Object.entries({ Heir, HeirOfHeir, BelowJudged, Alone, Plain })) Object.defineProperty(exports, name, { enumerable: true, get: () => value });
exports.mark = mark;
