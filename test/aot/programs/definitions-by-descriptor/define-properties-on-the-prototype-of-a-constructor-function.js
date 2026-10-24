// Object.defineProperties puts two accessors and a data property on the prototype object of a constructor function; one accessor is stored to.
function State() {
  this.bits = 0;
}
Object.defineProperties(State.prototype, {
  flowing: {
    get() { return (this.bits & 1) !== 0; },
    set(value) { if (value) this.bits |= 1; else this.bits &= ~1; },
  },
  ended: {
    enumerable: false,
    get() { return (this.bits & 2) !== 0; },
  },
  kind: { value: "state" },
});
const state = new State();
state.flowing = true;
console.log(state.flowing, state.ended, state.kind, state.bits);
