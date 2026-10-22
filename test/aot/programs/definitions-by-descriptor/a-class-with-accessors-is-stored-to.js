// A class of an untyped file has accessors, and one of them is stored to: the store runs the setter and adds no property.
class State {
  constructor() { this.bits = 0; }
  get flowing() { return (this.bits & 1) !== 0; }
  set flowing(value) { if (value) this.bits |= 1; else this.bits &= ~1; }
  get ended() { return (this.bits & 2) !== 0; }
}
const state = new State();
state.flowing = true;
console.log(state.flowing, state.ended, state.bits);
