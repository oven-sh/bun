// Methods that a loop over a constant list lays on a prototype, the list read elsewhere.
const VERBS = ["open", "close", "flush"];
class Pipe { constructor() { this.calls = 0; } knows(name) { return VERBS.includes(name); } }
for (const verb of VERBS) Pipe.prototype[verb] = function (count) { this.calls += count; return `${verb} ${this.calls} ${this.knows(verb)}`; };
const pipe = new Pipe();
console.log(pipe.open(1), pipe.close(2), pipe.flush(3), pipe.knows("read"), VERBS.join());
