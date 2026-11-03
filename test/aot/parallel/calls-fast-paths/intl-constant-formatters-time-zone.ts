// The process's time zone is read when the program runs, never when it is built: a formatter made from constants without a `timeZone`
// keeps the zone it was made in, like any formatter, and toLocaleString follows the zone of the moment. Everything is compared with
// the same call with arguments the compiler cannot see.
function notConstant<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
const times: number[] = [];
for (let hour = 0; hour < 24 * 366; hour += 5) times.push(1_704_067_200_000 + hour * 3_600_000 + 1_799_999);

function makeConstant(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium" });
}
function makeThroughICU(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(notConstant("en-US"), notConstant({ dateStyle: "medium", timeStyle: "medium" }));
}
function callConstant(date: Date): string {
  return date.toLocaleString("de", { dateStyle: "short", timeStyle: "short" }) + " " + date.toLocaleDateString("fr") + " " + date.toLocaleTimeString("ja");
}
function callThroughICU(date: Date): string {
  return date.toLocaleString(notConstant("de"), notConstant({ dateStyle: "short", timeStyle: "short" })) + " " + date.toLocaleDateString(notConstant("fr")) + " " + date.toLocaleTimeString(notConstant("ja"));
}
const made: [string, Intl.DateTimeFormat, Intl.DateTimeFormat][] = [];
function compare(zone: string) {
  made.push([zone, makeConstant(), makeThroughICU()]);
  for (const [madeIn, constant, throughICU] of made) {
    let differences = 0;
    for (const time of times) if (constant.format(time) !== throughICU.format(time)) differences++;
    console.log("in " + zone + ", a formatter made in " + madeIn + ": " + differences + " differences, " + (constant.resolvedOptions().timeZone === throughICU.resolvedOptions().timeZone));
  }
  let differences = 0;
  for (const time of times) if (callConstant(new Date(time)) !== callThroughICU(new Date(time))) differences++;
  console.log("in " + zone + ", calls: " + differences + " differences; " + new Date(times[0]).getHours() + " " + callConstant(new Date(times[0])).length);
}
compare("the zone at the start");
for (const zone of ["Asia/Tokyo", "America/New_York", "Australia/Lord_Howe", "UTC", "Europe/Berlin", "Asia/Tokyo"]) {
  process.env.TZ = zone;
  compare(zone);
}
