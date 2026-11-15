// A static method of a built-in that a variable of the file holds: read behind `?.`, stored after the declaration, or exported.
const ZonedDateTime = globalThis.Temporal?.ZonedDateTime;
export const PlainTime = self?.Temporal?.PlainTime;
var temporal;
class Bytes extends Float32Array {}
console.log(new Bytes(2).length);

function zoned(text) {
  return ZonedDateTime.from(text).timeZoneId;
}
console.log(zoned("2026-11-13T00:00[UTC]"));
const timed = depth => (depth > 0 ? timed(depth - 1) : String(PlainTime.from("12:30")));
console.log(timed(2));
for (const step of [1, 2]) {
  try {
    console.log(step, String(dated("2026-11-13")));
  } catch (error) {
    console.log(step, error.name);
  }
  temporal = globalThis.Temporal;
}
function dated(text) {
  return temporal.PlainDate.from(text);
}
