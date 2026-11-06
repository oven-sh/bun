type Sub = { k: number };
type State = { n: number; sub: Sub };
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
for (let round = 0; round < 3; round++) {
  const source = { s: new Proxy({ n: round, sub: { k: 2 } }, {}) };
  Object.assign(holder, { ...source });
  console.log(holder.s.n, holder.s.sub.k, holder.s === source.s);
}

export {};
