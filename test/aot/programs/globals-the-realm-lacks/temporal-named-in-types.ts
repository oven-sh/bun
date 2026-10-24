// BUN_JSC_useTemporal=0 takes the global Temporal away. The types of the program still name its classes, and code tests values against them.
function secondsOf(instant: Temporal.Instant | number): number {
  return typeof instant === "number" ? instant : Number(instant.epochMilliseconds) / 1000;
}
function now(): Temporal.Instant | number {
  return typeof Temporal !== "undefined" ? Temporal.Instant.fromEpochMilliseconds(5000) : 5;
}
function isInstant(value: unknown): value is Temporal.Instant {
  return typeof Temporal !== "undefined" && value instanceof Temporal.Instant;
}
let line = "";
for (let round = 0; round < 300; round++) line = secondsOf(now()) + " " + isInstant(now()) + " " + isInstant({});
console.log(line);
