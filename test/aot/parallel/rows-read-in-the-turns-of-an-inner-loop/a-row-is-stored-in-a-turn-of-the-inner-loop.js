// Rows of a list of lists read in an inner loop; the data comes out of a text, so nothing of it is seen at build time. A turn of the inner loop lays another row under `r + 1`: the next read finds it.
function blocks(modules, size, spare) { let score = 0; for (let r = 0; r < size - 1; r++) { for (let c = 0; c < size - 1; c++) { const m = modules[r][c]; if (m === modules[r + 1][c]) score += 3; if (c === 0 && spare.length) modules[r + 1] = spare.pop(); } } return score; }
const go = { blocks }[JSON.parse('"blocks"')];
const out = text => JSON.parse(text);
for (const [text, spare] of [['[[1,2,3],[1,2,3],[1,2,3]]', '[[9,2,9],[9,9,3]]'], ['[[true,true,true],[true,true,true],[true,true,true]]', '[[false,false,false]]'], ['[[1,2,3],[1,2,3],[1,2,3]]', '[]']]) { const modules = out(text); console.log(go(modules, 3, out(spare)), JSON.stringify(modules)); }
