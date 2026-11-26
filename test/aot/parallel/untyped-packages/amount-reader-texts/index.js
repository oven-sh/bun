// amounts with their units, read by one table after the other: spans of time, sizes of files, angles, prices, lengths, weights and times of day
"use strict";

var TABLES = {
  span: { base: "s", s: 1, sec: 1, min: 60, h: 3600, d: 86400, w: 604800 },
  size: { base: "B", B: 1, KB: 1000, MB: 1000000, KiB: 1024, MiB: 1048576 },
  angle: { base: "deg", deg: 1, turn: 360, grad: 0.9 },
  length: { base: "m", mm: 0.001, cm: 0.01, m: 1, km: 1000 },
  weight: { base: "g", mg: 0.001, g: 1, kg: 1000, t: 1000000 },
};

function Amount(kind, number, unit) {
  this.kind = kind;
  this.number = number;
  this.unit = unit;
}

Amount.prototype.inBase = function () {
  return this.number * TABLES[this.kind][this.unit];
};

Amount.prototype.as = function (unit) {
  var table = TABLES[this.kind];
  if (typeof table[unit] !== "number") throw new TypeError("no unit " + unit + " among " + this.kind);
  return new Amount(this.kind, this.inBase() / table[unit], unit);
};

Amount.prototype.toString = function () {
  var rounded = Math.round(this.number * 1000) / 1000;
  return rounded + this.unit;
};

function isDigit(code) {
  return code >= 48 && code <= 57;
}

function Cursor(text) {
  this.text = String(text);
  this.at = 0;
}

Cursor.prototype.blanks = function () {
  while (this.text.charCodeAt(this.at) === 32) this.at++;
};

Cursor.prototype.number = function () {
  var start = this.at;
  var sign = 1;
  if (this.text[this.at] === "-" || this.text[this.at] === "+") sign = this.text[this.at++] === "-" ? -1 : 1;
  var whole = 0;
  var digits = 0;
  while (isDigit(this.text.charCodeAt(this.at))) {
    whole = whole * 10 + this.text.charCodeAt(this.at++) - 48;
    digits++;
  }
  if (this.text[this.at] === "." && isDigit(this.text.charCodeAt(this.at + 1))) {
    this.at++;
    for (var place = 0.1; isDigit(this.text.charCodeAt(this.at)); place /= 10) {
      whole += (this.text.charCodeAt(this.at++) - 48) * place;
      digits++;
    }
  }
  if (digits === 0) {
    this.at = start;
    return null;
  }
  return sign * whole;
};

Cursor.prototype.word = function () {
  var start = this.at;
  while (/[A-Za-z]/.test(this.text.charAt(this.at))) this.at++;
  return this.text.slice(start, this.at);
};

function readOne(cursor, kinds) {
  cursor.blanks();
  var number = cursor.number();
  if (number === null) return null;
  cursor.blanks();
  var unit = cursor.word();
  for (var at = 0; at < kinds.length; at++) {
    var table = TABLES[kinds[at]];
    var name = unit === "" ? table.base : unit;
    if (typeof table[name] === "number") return new Amount(kinds[at], number, name);
  }
  return undefined;
}

function read(text, kinds) {
  var cursor = new Cursor(text);
  var found = [];
  var wanted = kinds || Object.keys(TABLES);
  while (cursor.at < cursor.text.length) {
    var one = readOne(cursor, wanted);
    if (one) found.push(one);
    else if (one === null) cursor.at++;
  }
  return found;
}

function sum(amounts) {
  var sums = {};
  for (var at = 0; at < amounts.length; at++) {
    var amount = amounts[at];
    sums[amount.kind] = (sums[amount.kind] || 0) + amount.inBase();
  }
  return sums;
}

function shortest(amount) {
  var table = TABLES[amount.kind];
  var best = amount;
  Object.keys(table).forEach(function (unit) {
    if (unit === "base") return;
    var other = amount.as(unit);
    if (other.toString().length < best.toString().length) best = other;
  });
  return best;
}

function timeOfDay(text) {
  var parts = String(text).split(":");
  var seconds = 0;
  for (var at = 0; at < 3; at++) {
    var part = parts[at] === undefined ? 0 : +parts[at];
    if (part !== part || part < 0 || part >= (at === 0 ? 24 : 60)) return null;
    seconds = seconds * 60 + part;
  }
  return new Amount("span", seconds, "s");
}

function price(text) {
  var found = /^(-?)([A-Z]{3})?\s*(\d+)(?:[.,](\d{1,2}))?$/.exec(text);
  if (!found) return null;
  var cents = +found[3] * 100 + (found[4] ? +(found[4] + "0").slice(0, 2) : 0);
  return { currency: found[2] || "EUR", cents: found[1] ? -cents : cents };
}

function addTable(kind, table) {
  TABLES[kind] = table;
  return Object.keys(TABLES).length;
}

module.exports = { Amount: Amount, read: read, sum: sum, shortest: shortest, timeOfDay: timeOfDay, price: price, addTable: addTable };
