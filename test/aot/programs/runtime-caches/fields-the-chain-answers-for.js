// Objects whose layout has a field for a name that a prototype answers for: flags that are accessors over one number (internal/streams/readable) and defaults that live on the prototype (node:_http_incoming).
// The slot of such a field stays empty. Each round reads and stores by name often enough to fill the caches, and between the rounds the answer changes on either side.
function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }

const kState = Symbol("kState");
function State() { this[kState] = 0; this.length = 0; }
function flag(bit) {
  return { configurable: true, enumerable: false, get() { return (this[kState] & bit) !== 0; }, set(value) { if (value) this[kState] |= bit; else this[kState] &= ~bit; } };
}
Object.defineProperties(State.prototype, { ended: flag(1), reading: flag(2), destroyed: flag(4) });
State.prototype.version = "1.1";
State.prototype.read = function read() { return "read " + this.length; };

function touch(state, i) {
  state.ended = (i & 1) === 0;
  state.reading = true;
  state.destroyed = false;
  state.length += 1;
  return state.ended + "," + state.reading + "," + state.destroyed + "," + state.version + "," + state.read() + "," + state[kState];
}

// What a proxy has seen is out of the compiler's sight, so these objects are read and stored by name.
const outOfSight = new Proxy({}, {});
outOfSight.value = State;
outOfSight.value = touch;

const kept = new State();
function round(label) {
  let last = "";
  for (let i = 0; i < 24; i++) last = attempt(() => touch(new State(), i) + " | " + touch(kept, i) + " own:" + Object.keys(kept));
  console.log(label + ": " + last);
}

round("start");
State.prototype.version = "2.0";
round("another inherited value");
kept.version = "own";
round("one object has its own");
delete kept.version;
round("and loses it");
State.prototype.read = function read() { return "reads " + this.length; };
round("another inherited method");
Object.defineProperty(kept, "ended", { configurable: true, enumerable: true, writable: true, value: "own ended" });
round("one object defines the name of a flag");
delete kept.ended;
round("definition deleted");
Object.defineProperty(State.prototype, "reading", { configurable: true, get() { return "always"; }, set(value) { this.length += 10; } });
round("another accessor");
Object.defineProperty(State.prototype, "reading", { configurable: true, get() { return "getter alone"; } });
round("a getter alone");
delete State.prototype.reading;
round("accessor deleted: the store fills the slot");
Object.defineProperties(State.prototype, { reading: flag(2) });
round("accessor back: objects that have the field keep it");
delete kept.reading;
round("field deleted");
delete State.prototype.version;
round("inherited value deleted");
const top = { version: "from the top" };
Object.setPrototypeOf(State.prototype, top);
round("found further up");
delete top.version;
round("deleted there");
const middle = Object.create(State.prototype, { destroyed: { configurable: true, get() { return "middle"; }, set(value) { } } });
Object.setPrototypeOf(kept, middle);
round("one object gets another prototype");
Object.freeze(kept);
round("a frozen object still calls setters");
