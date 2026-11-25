// A static method of a built-in, where the built-in is read behind `?.`, captured by a closure or copied to another name, beside a class below a typed array.
const PlainDate = globalThis.Temporal?.PlainDate;
class Bytes extends Uint8Array {}
console.log(new Bytes(2).length);
console.log(String(PlainDate.from("2026-11-13")), String(PlainDate?.from("2026-11-14")));

function formatter() {
  const PlainTime = Temporal.PlainTime;
  return text => String(PlainTime.from(text));
}
console.log(formatter()("12:30"));

function parser() {
  var duration = Temporal.Duration;
  return { parse: text => duration.from(text).total("minutes") };
}
console.log(parser().parse("PT1H30M"));

const temporal = self.Temporal;
const Instant = temporal?.Instant;
const copy = Instant;
for (const text of ["2026-11-13T00:00Z", "soon"]) {
  try {
    console.log(String(copy.from(text)));
  } catch (error) {
    console.log(error.name);
  }
}
const { PlainYearMonth } = globalThis?.Temporal;
console.log(String(PlainYearMonth.from("2026-11")), String(PlainYearMonth.from({ year: 2026, month: 12 })));
