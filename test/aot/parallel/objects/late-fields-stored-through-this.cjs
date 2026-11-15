// The methods of a constructor function store the fields that it leaves out, several methods some of them each. Objects that were filled in part, in other orders, twice or never read as they should.
// COUNT: operation:operationAOTEnsureExtensionGranules <= 4
"use strict";
const log = [];
const show = (o) =>
  Object.keys(o)
    .map((k) => k + "=" + (Object.is(o[k], -0) ? "-0" : typeof o[k] === "object" && o[k] ? "{" + Object.keys(o[k]).length + "}" : String(o[k])))
    .join(",");

function Moment(config) {
  this.locale = config.locale;
  this.parse(config);
  this.extra = this.extra || {};
}
const prototype = Moment.prototype;
prototype.parse = function (config) {
  this.date = config.date;
  if (!config.lazy) this.init(config.date);
};
prototype.init = function (date) {
  this.year = 1970 + date;
  this.month = date % 12;
  this.day = (date % 28) + 0.5;
  this.hour = date % 24;
  this.minute = -0;
  this.second = date & 1 ? null : undefined;
  this.zone = date % 3 ? "utc" : "local";
};
prototype.reverse = function (date) {
  this.zone = "back";
  this.second = date;
  this.minute = date;
  this.hour = date;
  this.day = date;
  this.month = date;
  this.year = date;
};
prototype.forget = function () {
  delete this.day;
  delete this.zone;
  return this;
};
prototype.sum = function () {
  return (this.year | 0) + (this.month | 0) + (this.hour | 0) + (this.day === undefined ? 1000 : this.day | 0);
};

const all = [];
for (let i = 0; i < 400; i++) {
  const moment = new Moment({ locale: i % 5 ? "en" : "es", date: i, lazy: i % 7 === 3 });
  if (i % 11 === 4) moment.reverse(i);
  if (i % 13 === 5) moment.forget();
  if (i % 17 === 6) moment.init(i + 1);
  if (i % 19 === 7) Object.freeze(moment);
  if (i % 23 === 8 && i % 19 !== 7) moment.later = i;
  all.push(moment);
}
let sum = 0;
for (let turn = 0; turn < 5; turn++) for (const moment of all) sum += moment.sum();
log.push(sum);
for (const moment of all) {
  try {
    moment.hour = "text";
    moment.day = moment;
  } catch (error) {
    log.push(error.constructor.name);
  }
}
const counts = new Map();
for (const moment of all) {
  const text = show(moment).replace(/\d+(\.\d+)?/g, "n");
  counts.set(text, (counts.get(text) ?? 0) + 1);
}
for (const [text, count] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) log.push(count + " " + text);
log.push(show(all[10]), show(all[4]), show(all[3]), "day" in all[3], all[3].zone, Object.hasOwn(all[3], "year"));
log.push(JSON.stringify({ ...all[6], day: 0 }), JSON.stringify(Object.assign({}, all[7], { day: 1 })));

// A getter, a setter and a field that cannot be stored into, above the late fields.
function Below(i) {
  this.id = i;
}
Below.prototype.fill = function (i) {
  this.a = i;
  this.b = i / 2;
  this.c = "c" + i;
};
Below.prototype.more = function (i) {
  this.d = i;
  this.e = null;
};
let stored = 0;
for (let i = 0; i < 60; i++) {
  if (i === 20) Object.defineProperty(Below.prototype, "b", { configurable: true, get: () => "above", set: (value) => void (stored += value) });
  if (i === 40) Object.defineProperty(Below.prototype, "e", { value: "fixed", writable: false, configurable: true });
  const below = new Below(i);
  try {
    if (i % 2) below.more(i);
    below.fill(i);
    if (i % 2 === 0) below.more(i);
  } catch (error) {
    log.push(i + error.constructor.name);
  }
  if (i % 10 < 2) log.push(show(below), below.b, below.e);
}
log.push(stored);
for (const line of log) console.log(line);
