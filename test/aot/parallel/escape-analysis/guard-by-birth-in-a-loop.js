// Flags: --aot-validate
// Every turn makes a list. Before the list is read a getter changes the list of the turn before, which it finds in the parser. This turn's list has gone nowhere yet: what is known of it since its birth holds.
function run(change, readsEarlier) {
  class Parser {
    constructor() { this.last = null; this.turn = 0; this.state = null; this.nodes = []; }
    make() { return { decorators: null, start: 0 }; }
    note(node, first) { node.start = first === undefined ? -1 : first; }
    list(turns, flags) {
      let sum = 0;
      for (let i = 0; i < turns; i++) {
        const decorators = [];
        decorators.push(i + 1);
        if (this.state.type === 26) sum += 1000000;
        const left = this.make();
        if (flags & 2) {
          const first = decorators[0];
          left.decorators = decorators;
          this.note(left, first);
        }
        this.last = left;
        this.nodes.push(left);
        sum += left.start;
      }
      return sum;
    }
  }
  const parser = new Parser();
  parser.state = { get type() { const node = parser.last; if (node && node.decorators) change(node.decorators, parser); return 0; } };
  const sum = parser.list(6, process.argv.length);
  return sum + " | " + parser.nodes.map(node => { try { return JSON.stringify(node.decorators) + ":" + node.decorators[0]; } catch (error) { return error.name; } }).join(" ");
}
const changes = {
  "an accessor at 0": list => Object.defineProperty(list, 0, { get() { return 70; }, configurable: true }),
  "emptied": list => { list.length = 0; },
  "a prototype with 0": list => { delete list[0]; Object.setPrototypeOf(list, { 0: 80, __proto__: Array.prototype }); },
  "frozen": list => Object.freeze(list),
  "sparse": list => { list[100000] = 1; delete list[0]; },
  "a double": list => { list[0] = 1.5; },
  "it becomes this.state": (list, parser) => { if (!Object.getOwnPropertyDescriptor(list, "type")) { const was = parser.state; Object.defineProperty(list, "type", { get() { list[0] = 90; return 0; } }); parser.state = list; } },
};
for (const [name, change] of Object.entries(changes))
  for (const readsEarlier of [false]) console.log(name, readsEarlier, run(change, readsEarlier));
