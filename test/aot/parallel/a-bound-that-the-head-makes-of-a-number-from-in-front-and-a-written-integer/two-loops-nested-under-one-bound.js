// STATISTIC: InvariantNumberGuardsHoisted >= 2
const rows = JSON.parse('[[true,true,false,true],[true,true,false,false],[false,true,true,true],[true,true,true,true]]');
class Field { constructor(side, plots) { this.side = side; this.plots = plots; } crossings() { const { side, plots } = this; let alike = 0; for (let row = 0; row < side - 1; row++) { for (let col = 0; col < side - 1; col++) { if (plots[row][col] !== plots[row + 1][col + 1]) continue; alike += plots[row][col + 1] === plots[row + 1][col] ? 5 : 1; } } return alike; } }
console.log(new Field(JSON.parse('4'), rows).crossings(), new Field(JSON.parse('2'), rows).crossings(), new Field(JSON.parse('1'), rows).crossings(), new Field(JSON.parse('3.5'), rows).crossings());
