const build = other => { const o = { n: 1 }; o.get = () => other.n; o.same = () => other === o; return o; };
export const make = () => build({ n: 7 });
