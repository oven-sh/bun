// Assorted, one probe of many. It prints what plain Bun prints.
const log: string[] = [];
function f(value: number): void { log.push((typeof value !== "number" ? "no number" : "a number") + " " + Object.prototype.toString.call(value)); }
f(1);
try {
  const groups: any = Object.groupBy([f], () => "k");
  log.push(Object.keys(groups).join(), typeof groups.k, typeof groups.k[0], String(groups.k[0] === f));
  groups.k[0]("s");
} catch (error) { log.push("threw " + String(error).slice(0, 150)); }
console.log(log.join("; "));
