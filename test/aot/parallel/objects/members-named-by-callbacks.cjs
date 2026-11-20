// Members of a prototype are named by the callback of a written list: dayjs, axios. The callback, its rows and the list may be used otherwise too.
"use strict";
const log = [];
function Day(value) {
  this.$y = value;
  this.$m = value % 12;
  this.init();
}
var proto = Day.prototype;
proto.init = function () {
  this.$d = this.$y * 2;
};
proto.get = function (field) {
  return this[field];
};
var year = "year";
[["$y", year], ["$m", "month"], ["$d", "date"]].forEach(function (row) {
  proto[row[1]] = function (input) {
    return input === undefined ? this.get(row[0]) : input + row[1];
  };
});
["first", "second"].forEach((name) => {
  Day.prototype[name] = function () {
    return name + this.$y;
  };
});
function sum(days) {
  let total = 0;
  for (let i = 0; i < days.length; i++) total += days[i].year() + days[i].month() + days[i].date();
  return total;
}
const days = [];
for (let i = 0; i < 30; i++) days.push(new Day(i));
log.push(sum(days), days[3].first(), days[4].second(), days[5].year("a"), Object.keys(Day.prototype).join());

// A list that the callback changes, a row that it changes, and a callback that others call.
function Other(value) {
  this.value = value;
}
Other.prototype.read = function () {
  return this.value;
};
["one", "two", "three"].forEach(function (name, index, list) {
  if (index === 0) list[2] = "read";
  Other.prototype[name] = function () {
    return name + index;
  };
});
const rows = [];
[["a", "left"], ["b", "right"]].forEach(function (row, index) {
  rows.push(row);
  if (index === 1) rows[1][1] = "two";
  Other.prototype[row[1]] = function () {
    return row[0];
  };
});
const named = function (name) {
  Other.prototype[name] = function () {
    return "named " + name;
  };
};
["four"].forEach(named);
named("one");
const other = new Other(7);
log.push(other.one(), other.two(), other.read(), other.left(), other.four(), other.three, other.right, Object.keys(Other.prototype).join());

// Keys that name the link, and what Object.prototype has.
function Linked() {
  this.own = 1;
}
Linked.prototype.read = function () {
  return this.own;
};
["__proto__", "toString", "constructor"].forEach(function (key) {
  Linked.prototype[key] = key === "__proto__" ? { found: () => "above" } : () => key;
});
const linked = new Linked();
log.push(linked.read(), linked.found(), String(linked), linked.constructor());
console.log(log.join("\n"));
