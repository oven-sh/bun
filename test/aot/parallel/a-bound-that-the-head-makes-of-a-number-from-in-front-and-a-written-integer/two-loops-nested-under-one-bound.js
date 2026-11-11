// STATISTIC: InvariantNumberGuardsHoisted >= 1
// STATISTIC: LoopsReversionedWithoutConditionalSpeculations >= 1
const rows = JSON.parse('[[true,true,false,true],[true,true,false,false],[false,true,true,true],[true,true,true,true]]');
class Grid { constructor(size, rows) { this.size = size; this.rows = rows; } blocks() { const { size, rows } = this; let score = 0; for (let r = 0; r < size - 1; r++) { for (let c = 0; c < size - 1; c++) { const m = rows[r][c]; if (m === rows[r][c + 1] && m === rows[r + 1][c] && m === rows[r + 1][c + 1]) score += 3; } } return score; } }
console.log(new Grid(JSON.parse('4'), rows).blocks(), new Grid(JSON.parse('2'), rows).blocks(), new Grid(JSON.parse('1'), rows).blocks(), new Grid(JSON.parse('3.5'), rows).blocks());
