// Flags: --aot-validate
// Nine ways in which the list of an earlier turn can still be named in this one: a list, an object, a pair, an inner loop, several ways round the loop, a throw, `arguments`, a closure, a yield. A getter changes it between two reads.
const changes = {
  "a double": list => { list[0] = 1.5; },
  "emptied": list => { list.length = 0; },
  "an accessor": list => Object.defineProperty(list, 0, { get() { return 70; }, configurable: true }),
  "it becomes this.state": (list, parser) => { if (!Object.getOwnPropertyDescriptor(list, "type")) { Object.defineProperty(list, "type", { get() { list[0] = 90; return 0; } }); parser.state = list; } },
};
function run(road, change) {
  class Parser {
    constructor() { this.last = null; this.state = null; this.nodes = []; }
    out(list) { const node = { decorators: list, start: 0 }; this.last = node; this.nodes.push(node); }
    keptInAList(turns, flags) {
      const seen = [], keep = [];
      for (let i = 0; i < turns; i++) {
        const list = [];
        if (flags & 2) list.push(i + 1);
        const old = keep.length ? keep[keep.length - 1] : list;
        const before = old[0];
        if (this.state.type === 26) seen.push("never");
        seen.push(before, old[0], list[0]);
        keep.push(list);
        this.out(list);
      }
      return seen;
    }
    keptInAnObject(turns, flags) {
      const seen = [], box = { held: null };
      for (let i = 0; i < turns; i++) {
        const list = [];
        if (flags & 2) list.push(i + 1);
        const old = box.held || list;
        const before = old[0];
        if (this.state.type === 26) seen.push("never");
        seen.push(before, old[0], list[0]);
        box.held = list;
        this.out(list);
      }
      return seen;
    }
    keptInAPair(turns, flags) {
      const seen = [];
      let pair = [null, 0];
      for (let i = 0; i < turns; i++) {
        const list = [];
        if (flags & 2) list.push(i + 1);
        const old = pair[0] || list;
        const before = old[0];
        if (this.state.type === 26) seen.push("never");
        seen.push(before, old[0], list[0]);
        pair = [list, i];
        this.out(list);
      }
      return seen;
    }
    madeInAnInnerLoop(turns, flags) {
      const seen = [];
      let last = null;
      for (let i = 0; i < turns; i++) {
        if (last) {
          const before = last[0];
          if (this.state.type === 26) seen.push("never");
          seen.push(before, last[0]);
        }
        for (let j = 0; j < 2; j++) {
          const list = [];
          if (flags & 2) list.push(i * 2 + j + 1);
          if (this.state.type === 26) seen.push("never");
          seen.push(list[0]);
          this.out(list);
          last = list;
        }
      }
      return seen;
    }
    severalLatches(turns, flags) {
      const seen = [];
      let old = null;
      for (let i = 0; i < turns; i++) {
        const list = [];
        if (flags & 2) list.push(i + 1);
        const before = old ? old[0] : -1;
        if (this.state.type === 26) seen.push("never");
        seen.push(before, old ? old[0] : -1, list[0]);
        this.out(list);
        if (i & 1) { old = list; continue; }
        if (i === 2) continue;
        old = null;
      }
      return seen;
    }
    thrownRoundTheLoop(turns, flags) {
      const seen = [];
      let old = null;
      for (let i = 0; i < turns; i++) {
        try {
          const list = [];
          if (flags & 2) list.push(i + 1);
          const before = old ? old[0] : -1;
          if (this.state.type === 26) seen.push("never");
          seen.push(before, old ? old[0] : -1, list[0]);
          this.out(list);
          if (flags & 2) throw list;
        } catch (thrown) {
          old = thrown;
        }
      }
      return seen;
    }
    keptInArguments(turns, flags, slot) {
      const seen = [];
      for (let i = 0; i < turns; i++) {
        const list = [];
        if (flags & 2) list.push(i + 1);
        const old = arguments[2] || list;
        const before = old[0];
        if (this.state.type === 26) seen.push("never");
        seen.push(before, old[0], list[0]);
        arguments[2] = list;
        this.out(list);
      }
      return seen;
    }
    keptByAClosure(turns, flags) {
      const seen = [];
      let held = null;
      const get = () => held;
      for (let i = 0; i < turns; i++) {
        const list = [];
        if (flags & 2) list.push(i + 1);
        const old = get() || list;
        const before = old[0];
        if (this.state.type === 26) seen.push("never");
        seen.push(before, old[0], list[0]);
        held = list;
        this.out(list);
      }
      return seen;
    }
    *keptAcrossAYield(turns, flags) {
      const seen = [];
      let old = null;
      for (let i = 0; i < turns; i++) {
        const list = [];
        if (flags & 2) list.push(i + 1);
        const before = old ? old[0] : -1;
        if (this.state.type === 26) seen.push("never");
        seen.push(before, old ? old[0] : -1, list[0]);
        this.out(list);
        old = list;
        yield i;
      }
      return seen;
    }
  }
  const parser = new Parser();
  parser.state = { get type() { const node = parser.last; if (node && node.decorators) change(node.decorators, parser); return 0; } };
  let seen = parser[road](5, process.argv.length, null);
  if (typeof seen.next === "function") { let step; do step = seen.next(); while (!step.done); seen = step.value; }
  return seen.map(value => (value === undefined ? "u" : String(value))).join(",");
}
for (const road of ["keptInAList", "keptInAnObject", "keptInAPair", "madeInAnInnerLoop", "severalLatches", "thrownRoundTheLoop", "keptInArguments", "keptByAClosure", "keptAcrossAYield"])
  for (const [name, change] of Object.entries(changes)) {
    let answer;
    try { answer = run(road, change); } catch (error) { answer = error.name; }
    console.log(road + " | " + name + ": " + answer);
  }
