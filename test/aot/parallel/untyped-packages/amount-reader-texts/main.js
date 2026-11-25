// An untyped package and a program of it (texts): amounts with their units, read by one table after the other: spans of time, sizes of files, angles, prices, lengths, weights and times of day
"use strict";
const { read, shortest, timeOfDay, price, addTable, Amount } = require("./index.js");
const words = [];
for (let round = 0; round < 120; round++) {
  const found = read(`walk ${round * 100}m, rest ${round}min;carry ${round * 250}g (${round}KB)`);
  words.push(found.map(amount => amount.kind[0] + shortest(amount)).join(" "));
  if (round % 35 === 0) console.log(round, words[round], found.map(String).join("|"));
}
console.log(words.join().length, words.filter((word, at) => at > 0 && word.length < words[at - 1].length).length);
for (const text of ["", " ", "12", "-3h", "+4.25 d", "1e5 s", "7 KiB7MiB", "3..5m", "5furlongs 6m", "∞ kg", "2m3", "0.1cm 0.2cm", "100000000000000000000mm"]) console.log(JSON.stringify(text), read(text).join(" "), read(text, ["length"]).join(" "));
for (const other of [null, undefined, 42, 3.5, true, ["4m", "5kg"], { toString: () => "6t" }, 9n]) console.log(typeof other, read(other).join(" "));
console.log(String(timeOfDay("7:05")), String(timeOfDay("24:00")), String(new Amount("angle", -0.00049, "deg")), String(new Amount("angle", 1 / 3, "turn").as("grad")), `${new Amount("size", NaN, "B")}`);
Amount.prototype.toString = function () {
  return "<" + this.number + " " + this.unit + ">";
};
console.log(read("1h 2min").join(), String(shortest(new Amount("span", 7200, "s"))));
addTable("span", { base: "beat", beat: 1, bar: 4 });
console.log(read("8beat 2bar 3h", ["span"]).join(), JSON.stringify(price("CHF 1,05")));
for (const bad of [Symbol("5m"), { toString: null, valueOf: null }]) {
  try {
    read(bad);
    console.log("read");
  } catch (error) {
    console.log(error.constructor.name);
  }
}
