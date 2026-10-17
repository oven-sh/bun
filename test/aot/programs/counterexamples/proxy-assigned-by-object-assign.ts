// A Proxy of an object of a type is of that type, by whatever door it enters a field.
type State = { n: number };
const holder: { s: State } = { s: { n: 1 } };
Object.assign(holder, { s: new Proxy({ n: 2 }, {}) });
console.log(holder.s.n);
