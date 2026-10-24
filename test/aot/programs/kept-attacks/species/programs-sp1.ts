// Species, one probe of many. It prints what plain Bun prints.
const log: string[] = [];
function thrown(value: number): void { log.push("called with " + (typeof value !== "number" ? "no number" : "a number") + " " + Object.prototype.toString.call(value)); }
thrown(1);
class Mine extends Array { static get [Symbol.species](): any { log.push("species getter"); throw thrown; } }
try {
  const made = Mine.from([1]);
  log.push("made " + (made instanceof Mine));
  const mapped = made.map(one => one);
  log.push("mapped " + (mapped instanceof Mine));
} catch (caught) {
  log.push("caught " + typeof caught);
  (caught as any)("s");
}
class Other extends Array { static get [Symbol.species](): any { log.push("species getter 2"); return Array; } }
const other = Other.from([1]).map(one => one);
log.push("other " + (other instanceof Other));
console.log(log.join("; "));
