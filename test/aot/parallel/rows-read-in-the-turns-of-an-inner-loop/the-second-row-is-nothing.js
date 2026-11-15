// Rows of a list of lists read in an inner loop; the data comes out of a text, so nothing of it is seen at build time. The row under `r + 1` is null, is missing, or lies beyond the end: the read throws where plain Bun throws, and does not where the inner loop has no turn.
let seen = 0;
function blocks(modules, size, width) { let score = 0; for (let r = 0; r < size; r++) { for (let c = 0; c < width; c++) { const m = modules[r][c]; seen++; if (m === modules[r + 1][c]) score += 3; } } return score; }
const go = { blocks }[JSON.parse('"blocks"')];
const out = text => JSON.parse(text);
for (const [text, size, width] of [['[[1,2],[1,2]]', 1, 2], ['[[1,2],[1,2]]', 2, 2], ['[[1,2],[1,2]]', 2, 0], ['[[1,2],null,[1,2]]', 2, 2], ['[[1,2],null]', 1, 0]]) { try { console.log(go(out(text), size, width), seen); } catch (error) { console.log(error instanceof TypeError, seen); } }
