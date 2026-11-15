// What a loop, a spread or a pattern calls under Symbol.iterator, next and return: a plain method answers an object with next and it is spread.
class Row { constructor(private cells: number[]) {} [Symbol.iterator]() { let place = 0; const cells = this.cells; return { next() { return place < cells.length ? { done: false, value: cells[place++] } : { done: true, value: undefined }; } }; } }
function listed(row: Row): string { return [0, ...row, 9].join(); }
for (let turn = 0; turn < 3; turn++) console.log(listed(new Row([1, 2, turn])));
