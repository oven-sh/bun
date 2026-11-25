// Rows of a list of lists read in an inner loop; the data comes out of a text, so nothing of it is seen at build time. `next` is undefined or null and the turns never come to read it; where they do, the read throws as in plain Bun.
function pairs(tiles, size) { let alike = 0; for (let r = 0; r < size - 1; r++) { const row = tiles[r], next = tiles[r + 1]; for (let c = 0; c < size - 1; c++) { const tile = row[c]; if (tile === next[c + 1] && row[c + 1] === next[c]) alike += 5; } } return alike; }
const go = { pairs }[JSON.parse('"pairs"')];
const out = text => JSON.parse(text);
for (const [text, size] of [['[[1,2,3],null,[4,5,6]]', 2], ['[[1,2,3]]', 2], ['[[1,1,3],null]', 2], ['[[1,2,2]]', 3]]) { try { console.log(go(out(text), size)); } catch (error) { console.log(error instanceof TypeError); } }
