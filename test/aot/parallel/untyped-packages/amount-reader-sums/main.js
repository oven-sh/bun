// An untyped package and a program of it (sums): amounts with their units, read by one table after the other: spans of time, sizes of files, angles, prices, lengths, weights and times of day
"use strict";
const { read, sum, timeOfDay, price, addTable, Amount } = require("./index.js");
let all = 0;
for (let round = 0; round < 200; round++) {
  const line = `${round % 7}h ${round}min 3.5s, ${round * 2}KB and 1MiB; ${round / 4}turn 12 deg 8cm ${round}km -2kg .5 ${round % 3}x`;
  const sums = sum(read(line));
  for (const kind of Object.keys(sums)) all = (all * 3 + Math.round(sums[kind] * 1000)) % 1000003;
  if (round % 60 === 0) console.log(round, JSON.stringify(sums));
}
console.log(all);
let seconds = 0;
let cents = 0;
for (let at = 0; at < 100; at++) {
  const time = timeOfDay((at % 26) + ":" + (at % 61) + (at % 2 ? ":" + (at % 60) : ""));
  seconds += time === null ? 1 : time.inBase();
  const paid = price((at % 5 ? "" : "-") + (at % 3 ? "USD " : "") + at + (at % 4 ? "." + (at % 100) : ""));
  cents += paid === null ? 1 : paid.cents + paid.currency.length;
}
console.log(seconds, cents, timeOfDay("nine"), timeOfDay(7.5), timeOfDay("23:59:59").inBase(), price("12,5").cents, price("12.345"), price(undefined), price("JPY400").currency);
const one = new Amount("length", 1500, "m");
console.log(one.as("km").number, one.as("mm").inBase(), one.number + one.as("cm").number);
try {
  one.as("kg");
} catch (error) {
  console.log(error.constructor.name, error.message);
}
console.log(addTable("money", { base: "ct", ct: 1, eur: 100 }), JSON.stringify(sum(read("3eur 20ct 4 5h", ["money", "span"]))));
addTable("odd", { base: "q", q: NaN, r: Infinity, s: "text" });
console.log(JSON.stringify(sum(read("1q 2r 3s", ["odd"]))), JSON.stringify(sum([])), read("", ["span"]).length, read("5 5 5").length);
