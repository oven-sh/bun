// Rows of a list of lists read in an inner loop; the data comes out of a text, so nothing of it is seen at build time. `const row = tiles[r], next = tiles[r + 1]`: `next` is read behind `&&`, in some turns only: beside `row` it is asked in front of the loop too.
function pairs(tiles, size) { let alike = 0; for (let r = 0; r < size - 1; r++) { const row = tiles[r], next = tiles[r + 1]; for (let c = 0; c < size - 1; c++) { const tile = row[c]; if (tile === next[c + 1] && row[c + 1] === next[c]) alike += 5; } } return alike; }
const go = { pairs }[JSON.parse('"pairs"')];
const out = text => JSON.parse(text);
for (let turn = 0; turn < 2; turn++) for (const text of ['[[true,true,false],[true,true,true],[true,true,true]]', '[[1,1,1],[1,1,1],[1,1,2]]', '[[0.5,0.5,0.5],[0.5,0.5,0],[0,0,0]]', '["aaa","aab","bbb"]', '[[1,1,1],"111",[1,1,1]]', '[["a","a","a"],["a","a","a"],["a","b","a"]]']) console.log(go(out(text), 3));
