const o = { a: { b: { c: { d: { e: 1 } } } } };
o.toString = () => "mine";
export const read = () => o;
