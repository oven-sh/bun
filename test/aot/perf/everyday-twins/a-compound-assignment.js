// `c += x` is `c = c + x`.
const data = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5,12.5,13.5,14.5,15.5]"), key = JSON.parse('["writtenOut","compound","orZero","inAField"]');
const table = {
  writtenOut(s) { let c = 0; for (let i = 0; i < s.length; i++) c = c + s[i]; return c; },
  compound(s) { let c = 0; for (let i = 0; i < s.length; i++) c += s[i]; return c; },
  orZero(s) { let c = 0; for (let i = 0; i < s.length; i++) c += s[i] ?? 0; return c; },
};
export const loops = {
  "a sum written out": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (table[key[0]](data))) | 0; return s; },
  "a sum by a compound assignment": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (table[key[1]](data))) | 0; return s; },
  "a sum with a default": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (table[key[2]](data))) | 0; return s; },
};
