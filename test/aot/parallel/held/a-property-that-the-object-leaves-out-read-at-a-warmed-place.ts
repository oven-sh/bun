// A read by name of a property that the object leaves out, at one place that is come by again and again, so that the place is warmed.
// Then whatever makes the answer another one: each deed is done behind the warming, and the same place is asked again.
interface Options {
  depth: number;
  signal?: string;
  name: string;
  late?: string;
}
function make(withSignal: boolean): Options {
  return withSignal ? { depth: 1, signal: "signal", name: "with" } : { depth: 1, signal: undefined, name: "without" };
}
function bare(): Options {
  return { depth: 2, name: "bare" };
}
// Nothing is known of the parameter: whoever the build has not seen calls it too.
function signalOf(options: any) {
  return options.signal;
}
function lateOf(options: any) {
  return options.late;
}
const unseen = new Function("signalOf", "lateOf", "make", "bare", `
  const lines = [];
  const say = (...words) => lines.push(words.map(String).join(" "));
  const attempt = (label, body) => { try { say(label, body()); } catch (error) { say(label, "throws", error.constructor.name); } };
  const warm = () => { let seen = 0; for (let turn = 0; turn < 400; turn++) { if (signalOf(bare()) === undefined) seen++; if (lateOf(bare()) === undefined) seen++; } return seen; };
  say("warmed", warm());

  const deeds = {
    "stored again": value => { value.signal = "again"; },
    "stored as a number": value => { value.signal = 7; },
    "defined as a getter": value => { Object.defineProperty(value, "signal", { get() { return "got"; }, configurable: true }); },
    "defined read only": value => { Object.defineProperty(value, "signal", { value: "fixed" }); },
    "defined as undefined": value => { Object.defineProperty(value, "signal", { value: undefined, enumerable: true }); },
    "frozen while it lacks it": value => { Object.freeze(value); },
    "laid below an object that has it": value => { Object.setPrototypeOf(value, { signal: "from above", late: "late above" }); },
    "laid below a getter": value => { Object.setPrototypeOf(value, { get signal() { return "getter above of " + this.name; } }); },
    "laid below null": value => { Object.setPrototypeOf(value, null); },
    "laid below a proxy": value => { Object.setPrototypeOf(value, new Proxy({ }, { get(target, key) { return "proxy says " + String(key); } })); },
    "given another property": value => { value.late = "late"; },
    "another field moved out": value => { Object.defineProperty(value, "name", { get() { return "got name"; }, configurable: true }); },
    "deleted, stored, deleted": value => { value.signal = 1; delete value.signal; },
  };
  for (const [label, deed] of Object.entries(deeds)) {
    const value = bare();
    say(label, "before:", signalOf(value), lateOf(value));
    deed(value);
    attempt(label + ": signal", () => signalOf(value));
    attempt(label + ": late", () => lateOf(value));
    attempt(label + ": has", () => "signal" in value);
    say(label, "another object:", signalOf(bare()), lateOf(bare()), signalOf(make(true)), signalOf(make(false)));
  }

  for (const stranger of [{ }, { signal: 1 }, [], "text", 5, true, Symbol.iterator, () => 1, new Map(), Object.create({ signal: "created below" }), new Proxy({ }, { get() { return "proxy"; } }), null, undefined])
    attempt("stranger", () => signalOf(stranger) + " " + lateOf(stranger));
  say("warmed again", warm());
  return lines.join("\\n");
`);
console.log(unseen(signalOf, lateOf, make, bare));
