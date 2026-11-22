// The static methods of objects that get further properties.
class Bytes extends Uint8Array {}
console.log(new Bytes(2).length);
Object.defineProperty(Temporal, 1, { value: 5 });
Object.defineProperties(Temporal.Duration, { extra: { value: 6 } });

function read(text) {
  return String(Temporal.PlainTime.from(text));
}
console.log(Temporal[1], Temporal.Duration.extra, read("12:30"), String(Temporal.Duration.from({ hours: 2 })));
