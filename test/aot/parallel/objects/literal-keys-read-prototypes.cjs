// A key that is one of the program's own texts reads a field or a member of the prototype object that a constructor function makes objects of. What is read is converted, called, kept, and may be any of many functions.
"use strict";
const log = [];
function Day(value) {
  this.$y = value;
  this.$m = value % 12;
  this.$d = new Date(value * 1000);
  this.$x = {};
  this.$L = "en";
}
const prototype = Day.prototype;
prototype.valueOf = function () {
  return this.$y;
};
prototype.clone = function () {
  return new Day(this.$y);
};
prototype.put = function (name, value) {
  if (name === "year") this.$y = value;
  else this.$m = value;
  return this;
};
prototype.set = function (name, value) {
  return this.clone().put(name, value);
};
prototype.add = function (count) {
  return this.set("year", this.$y + count);
};
prototype.diff = function (other) {
  return this.$y - other.$y;
};
prototype.isBefore = function (other) {
  return this < other;
};
prototype.$g = function (input, field, name) {
  return input === undefined ? this[field] : this.set(name, input);
};
[
  ["$y", "year"],
  ["$m", "month"],
  ["$d", "date"],
  ["$x", "extra"],
].forEach(function (row) {
  prototype[row[1]] = function (input) {
    return this.$g(input, row[0], row[1]);
  };
});
const days = [];
for (let i = 1; i < 6; i++) days.push(new Day(2020 + i));
function text(value) {
  if (typeof value === "function") return "function";
  if (value instanceof Day) return "day" + value.$y + "." + value.$m;
  if (value instanceof Date) return "date" + value.getTime();
  return typeof value === "object" ? "object" : typeof value + String(value);
}
let total = 0;
for (let turn = 0; turn < 50; turn++)
  for (const day of days) {
    total += day.year() * 2 + (day.month() | 0) + day.add(1).year() + (day.isBefore(days[4]) ? 1 : 0) + day.diff(days[0]);
    total += day.date() > 5 ? 1 : 0;
    total += `${day.extra()}`.length + (day.year(1999) < 2000 ? 1 : 0);
  }
log.push(total);
for (const day of days) log.push(text(day.year()), text(day.month()), text(day.date()), text(day.extra()), text(day.month(3)));

function read(day, key) {
  return day[key];
}
function call(day, key) {
  try {
    return text(day[key]());
  } catch (error) {
    return error.name;
  }
}
for (const key of ["$y", "clone", "$d", "valueOf", "absent", "$L", "put"]) log.push(text(read(days[0], key)), call(days[1], key), String(read(days[2], key)).length > 0);
for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) log.push(read(days[0], key) === Day, typeof read(days[0], key), read(days[0], key) === prototype);
log.push(text(read(days[0], 1)), text(read(days[0], undefined)), text(read(days[0], Symbol.iterator)));

// Functions answer conversions of their own.
prototype.add.valueOf = function () {
  days[3].$y = "seen";
  return 42;
};
prototype.diff.toString = function () {
  days[4].$m = "text";
  return "own text";
};
function pick(i) {
  return i === 0 ? "add" : i === 1 ? "diff" : "$y";
}
for (let i = 0; i < 3; i++) {
  const value = read(days[2], pick(i));
  log.push(text(1 + value), value < 43, `${value}`.length > 2, days[3].$y, days[4].$m);
}

// Getters and later members.
Object.defineProperty(prototype, "late", {
  get() {
    this.$y = "late" + this.$y;
    return this.$y;
  },
  configurable: true,
});
for (let i = 0; i < 2; i++) log.push(text(read(days[1], i ? "late" : "$y")), text(days[1].$y));
prototype.clone = function () {
  return "other";
};
log.push(call(days[1], "clone"));
days[1].clone = 7;
log.push(call(days[1], "clone"), text(read(days[1], "clone")));
delete days[0].$y;
prototype.$y = "below";
log.push(text(read(days[0], "$y")), text(days[0].year()), Object.keys(days[0]).join());
class Heir extends Day {
  own() {
    return "own" + this.$m;
  }
}
const heir = new Heir(2030);
log.push(call(heir, "own"), call(heir, "clone"), text(read(heir, "$m")), text(heir.date()));
console.log(log.join("|"));
