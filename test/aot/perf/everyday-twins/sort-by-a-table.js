// the comparator comes out of a table.
const up = (a, b) => a - b, by = { up, down: (a, b) => b - a }, keys = JSON.parse('["up","down"]');
export const loops = {
  "a sort by a comparator with a name": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ([5, 3, 9, 1, i & 7].sort(up)[0])) | 0; return s; },
  "a sort by a comparator out of a table": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ([5, 3, 9, 1, i & 7].sort(by[keys[i & 1]])[0])) | 0; return s; },
  "a search for what a table answers": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (([1, 2, 3].includes(by[keys[0]](i & 3, 0)) ? 1 : 2))) | 0; return s; },
};
