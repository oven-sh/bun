// things are counted under names.
const words = JSON.parse('["tea","ten","team","to","inn","in","tea","to"]'), counts = {}, pairs = {}, map = new Map(), matrix = {};
function keyOf(a, b) { return a + ":" + b; }
export const loops = {
  "counts in a map": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((map.set(words[i & 7], (map.get(words[i & 7]) || 0) + 1), 1))) | 0; return s; },
  "counts in an object": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((counts[words[i & 7]] = ((counts[words[i & 7]] || 0) + 1) & 1023))) | 0; return s; },
  "counts by a step": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((matrix[words[i & 7]] === undefined ? matrix[words[i & 7]] = 1 : matrix[words[i & 7]]++ & 1))) | 0; return s; },
  "under a key of two parts": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((pairs[words[i & 7] + ":" + (i & 3)] = ((pairs[words[i & 7] + ":" + (i & 3)] || 0) + 1) & 1023))) | 0; return s; },
  "under a key that a helper makes": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((pairs[keyOf(words[i & 7], i & 3)] = ((pairs[keyOf(words[i & 7], i & 3)] || 0) + 1) & 1023))) | 0; return s; },
};
