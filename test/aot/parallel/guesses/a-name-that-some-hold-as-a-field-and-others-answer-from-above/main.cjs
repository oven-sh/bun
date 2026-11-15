// One reader of `.headers` that is told nothing; two constructor functions hold the name as a field; the others answer it from above: by a class's accessor, by defineProperty, by a map of descriptors, by a method; and what answers is deleted or replaced at the run
const about = require("./reader.cjs");
const { Accepted, Kept } = require("./holders.cjs");
const held = length => ({ "content-length": String(length), "content-type": "text/" + length });
class ByClass {
  constructor(length) { this.kept = held(length); }
  get headers() { return this.kept; }
}
function ByDefinition(length) { this.kept = held(length); }
Object.defineProperty(ByDefinition.prototype, "headers", { get() { return this.kept; }, set(value) { this.kept = value; }, configurable: true });
function ByDescriptors(length) { this.kept = held(length); }
Object.defineProperties(ByDescriptors.prototype, { headers: { get() { return this.kept; }, configurable: true }, other: { value: 1 } });
class Below extends ByClass {}
class ByMethod {
  headers() { return held(9); }
}
const log = [];
function tell(label, make) {
  let said = "";
  for (let turn = 0; turn < 30; turn++) {
    let now;
    try {
      const message = make(turn);
      now = String(about(message)) + " " + about.hasBody(message);
    } catch (error) {
      now = "threw " + error.constructor.name;
    }
    if (!said.endsWith(now)) said += (said ? " THEN " : "") + now;
  }
  log.push(label + ": " + said);
}
for (let round = 0; round < 2; round++) {
  tell("a class's accessor", () => new ByClass(1));
  tell("a field", () => new Accepted(new ByClass(2)));
  tell("another field", () => new Kept(held(3), "chunk"));
  tell("by defineProperty", () => new ByDefinition(4));
  tell("by a map of descriptors", () => new ByDescriptors(5));
  tell("an heir", () => new Below(6));
  tell("a literal", () => ({ headers: held(7) }));
  tell("a method under the name", () => new ByMethod());
  tell("in turns", turn => [new ByClass(1), new Accepted(new ByClass(2)), new ByDefinition(4), { headers: held(7) }][turn & 3]);
  tell("a field over the accessor", () => Object.defineProperty(new ByClass(1), "headers", { value: held(8) }));
  tell("stored through the setter", () => { const made = new ByDefinition(4); made.headers = held(10); return made; });
  tell("nothing under the name", () => ({}));
  tell("undefined", () => undefined);
}
delete ByDescriptors.prototype.headers;
tell("the accessor deleted", () => new ByDescriptors(5));
Object.defineProperty(ByDefinition.prototype, "headers", { get() { return held(11); }, configurable: true });
tell("the accessor replaced", () => new ByDefinition(4));
Object.defineProperty(ByDefinition.prototype, "headers", { value: held(12), configurable: true });
tell("a value in its place", () => new ByDefinition(4));
Object.defineProperty(Accepted.prototype, "headers", { get() { return held(13); }, configurable: true });
tell("an accessor above a field", () => new Accepted(new ByClass(2)));
console.log(log.join("\n"));
