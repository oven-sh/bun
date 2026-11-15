// The static methods of objects that the program freezes, seals or stops from growing.
class Floats extends Float32Array {}
console.log(new Floats(2).length);
Object.freeze(Temporal);
Object.seal(Temporal.Duration);

function read(text) {
  return String(Temporal.PlainTime.from(text));
}
console.log(read("12:30"), read("13:45"), String(Temporal.Duration.from({ hours: 2 })));
try {
  "use strict";
  Temporal.PlainTime = null;
} catch (error) {
  console.log(error.name);
}
console.log(read("14:00"));
