// Rows of a list of lists read in an inner loop; the data comes out of a text, so nothing of it is seen at build time. `tiles[r + 1]` is found behind `&&`: in the turn of the typed copy that row is asked there whether it is a list as made and of which storage.
function pairs(tiles, size) { let alike = 0; for (let r = 0; r < size - 1; r++) { for (let c = 0; c < size - 1; c++) { const tile = tiles[r][c]; if (tile === tiles[r + 1][c + 1] && tiles[r][c + 1] === tiles[r + 1][c]) alike += 5; } } return alike; }
const go = { pairs }[JSON.parse('"pairs"')];
const out = text => JSON.parse(text);
for (let turn = 0; turn < 2; turn++) for (const text of ['[[true,true,false],[true,true,true],[true,true,true]]', '[[1,1,1],[1,1,1],[1,1,2]]', '[[0.5,0.5,0.5],[0.5,0.5,0],[0,0,0]]', '[[1,1,1],[1,1.5,1],[1,1,1]]', '["aaa","aab","bbb"]', '[[1,1,1],"111",[1,1,1]]', '[[1,1,1],null,[1,1,1]]']) { try { console.log(go(out(text), 3)); } catch (error) { console.log(error instanceof TypeError); } }
