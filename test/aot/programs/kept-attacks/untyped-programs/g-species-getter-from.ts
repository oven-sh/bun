// Untyped programs: g species getter from. It prints what plain Bun prints.
const log: string[] = [];
class Mine extends Array { static get [Symbol.species](): any { log.push("species getter"); throw 5; } }
try {
  const made = Mine.from([1]);
  log.push("made " + (made instanceof Mine));
  made.map(one => one);
} catch (caught) {
  log.push("caught " + typeof caught + " " + String(caught));
}
console.log(log.join("; "));
