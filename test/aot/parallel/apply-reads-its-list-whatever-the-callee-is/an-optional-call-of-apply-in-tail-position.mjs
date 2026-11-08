// `return x.apply?.(t, list)` with an x that cannot be called: the list is read, then the TypeError. The call stays a call of what was read under `apply`, and it is the last of its function.
let reads = 0;
const fake = Object.create(Function.prototype);
const like = () => ({ get length() { reads++; return 0; } });
const list = () => { const made = [1, 2]; Object.defineProperty(made, 0, { get() { reads++; return 1; } }); return made; };
const tail = (callee, given) => callee.apply?.(null, given);
for (const make of [like, list]) {
  reads = 0;
  try { tail(fake, make()); } catch (error) { console.log(error instanceof TypeError, reads); }
}
