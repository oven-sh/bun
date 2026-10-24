// A method comes back out of an array whose contents nobody knows and is run through `apply` with another receiver and another argument. What `taken.apply` answers may be anything, and `apply` itself is among it.
const log: string[] = [];
class Meter {
  size = 1;
  measure(by: number): string {
    return (this instanceof Meter ? "a meter" : "no meter") + " " + (typeof by === "number" ? "a number" : "no number");
  }
}

log.push(new Meter().measure(1));
const held: any[] = JSON.parse("[]");
held.push(new Meter());
const taken = held[0].measure;
log.push(taken.apply({ size: "s" }, ["s"]));
console.log(log.join("; "));
