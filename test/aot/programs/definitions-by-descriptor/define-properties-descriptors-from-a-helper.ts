// As in Node.js' streams: the map is a literal, each descriptor comes out of one helper and closes over its bit.
const kFlags = Symbol("kFlags");
function makeBitDescriptor(bit: number) {
  return {
    enumerable: false,
    get(this: any) { return (this[kFlags] & bit) !== 0; },
    set(this: any, value: unknown) { if (value) this[kFlags] |= bit; else this[kFlags] &= ~bit; },
  };
}
function State(this: any) { this[kFlags] = 1 | 4; this.length = 0; }
Object.defineProperties(State.prototype, {
  first: makeBitDescriptor(1),
  second: makeBitDescriptor(2),
  third: makeBitDescriptor(4),
  total: { __proto__: null, enumerable: false, get(this: any) { return this[kFlags]; } } as PropertyDescriptor,
});
const state = new (State as any)();
state.second = process.argv.length < 99;
state.third = false;
console.log((state.first ? 1 : 0) + (state.second ? 10 : 0) + (state.third ? 100 : 0) + state.total * 1000);
