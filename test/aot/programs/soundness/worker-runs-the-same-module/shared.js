let c = 0;
export const obj = { n: 0, list: [] };
export const inc = () => { obj.n++; obj.list.push(c); return ++c; };
