// Rows of a list of lists read in an inner loop; the data comes out of a text, so nothing of it is seen at build time. `modules[r][c]` and `modules[r + 1][c]`: the second row's key is made out of what stands in front of the inner loop: both rows are read once in front of the typed copy.
function blocks(modules, size) { let score = 0; for (let r = 0; r < size - 1; r++) { for (let c = 0; c < size - 1; c++) { const m = modules[r][c]; if (m === modules[r + 1][c]) score += 3; } } return score; }
const go = { blocks }[JSON.parse('"blocks"')];
const out = text => JSON.parse(text);
for (let turn = 0; turn < 2; turn++) for (const text of ['[[true,false,true],[true,true,true],[false,true,true]]', '[[1,2,3],[1,5,3],[1,5,9]]', '[[0.5,1.5,2.5],[0.5,0,2.5],[0,0,0]]', '[["a","b","c"],["a","x","c"],["y","x","c"]]', '["abc","axc","yxc"]', '[[null,1,2],[null,1,2],[3,1,2]]']) console.log(go(out(text), 3));
