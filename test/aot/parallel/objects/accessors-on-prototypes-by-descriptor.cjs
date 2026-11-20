"use strict";
const lines = [];
const tell = (...values) => lines.push(values.map(String).join(" "));

function poured(value, room) {
  const asked = value ?? 1;
  if (asked > room) return room;
  return asked - (asked % 0.25);
}
function Jar(level) {
  this._level = level;
  this.place = 0;
}
Object.defineProperty(Jar.prototype, "level", {
  get: function () {
    return this._level;
  },
  configurable: true,
  set: function (value) {
    this._level = poured(value, 3);
  },
});
Object.defineProperty(Jar.prototype, "label", {
  get() {
    return typeof this + ":" + this._level;
  },
});
Jar.prototype.slide = function (by) {
  this.place = poured(this.place - by * 2, 10);
  return this.place;
};
function Jug(level) {
  Jar.call(this, level);
}
Jug.prototype = Object.create(Jar.prototype);
Jug.prototype.constructor = Jug;

const run = count => {
  const jar = new Jar(1);
  const jug = new Jug(2);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    jar.level = i * 0.25;
    jug.level = i & 1 ? i : -0.5;
    sum += jar.level + jug.level + jar.slide(i & 1 ? 0.5 : -0.25);
  }
  return sum;
};
tell(run(10), run(200), new Jar(5).label, new Jug("s").label);

const jar = new Jar(2);
jar.level = "late";
tell(jar.level, jar._level);
jar.level = { valueOf: () => 2.5 };
tell(typeof jar.level, jar.level + 0);
try {
  jar.label = 1;
} catch (error) {
  tell(error.constructor.name);
}

const { get, set } = Object.getOwnPropertyDescriptor(Jar.prototype, "level");
tell(get.call({ _level: "other" }), get.name, set.length, typeof get.prototype, new get() instanceof get);
const bare = {};
set.call(bare, 9);
set.call(bare, 2, 7);
tell(Object.keys(bare).join(), bare._level, run(10));
try {
  set(1);
} catch (error) {
  tell(error.constructor.name);
}

const seen = [];
const watched = new Proxy(new Jar(1), {
  get(target, key, receiver) {
    seen.push(String(key));
    return Reflect.get(target, key, receiver);
  },
});
watched.level = 2;
tell(watched.level, seen.join(), Reflect.get(Jar.prototype, "level", { _level: -0 }) === 0, Reflect.set(Jar.prototype, "level", 8, bare), bare._level);

const below = Object.create(jar);
below.level = 1;
tell(Object.keys(below).join(), below.level, jar._level);
for (const key of ["level", "label", "place"]) tell(key, text(jar[key]), key in jar, Object.hasOwn(jar, key));
function text(value) {
  return typeof value === "object" ? "object" : value;
}
tell(JSON.stringify(new Jar(1)), JSON.stringify(Object.assign(new Jar(1), { level: 7 })));

Object.defineProperty(Jug.prototype, "level", {
  get: () => "jug",
  set(value) {
    super.level = value;
    this.kept = value;
  },
});
const jug = new Jug(1);
jug.level = 1.5;
tell(jug.level, jug._level, jug.kept);

Object.defineProperty(Jar.prototype, "level", { get: undefined, set: undefined });
tell(jar.level, new Jar(4).level, jug.level);
delete Jar.prototype.level;
jar.level = 12;
tell(jar.level, Object.keys(jar).join());
console.log(lines.join("\n"));
