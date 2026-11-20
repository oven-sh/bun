// A class in a file without types: a constructor's parameter fills the field, so nothing is written of it; what the class's own methods do with `this.<name>` gives the field a word, as a parameter's uses give the parameter one. The word is expected alone: every read is guarded at the run. The data comes out of a text. The field is stored again from outside the class and by another method, with other kinds.
class Matrix { constructor(rows) { this.rows = rows; } take(rows) { this.rows = rows; return this; } count() { let s = 0; for (let r = 0; r < this.rows.length; r++) for (let c = 0; c < this.rows[r].length; c++) if (this.rows[r][c]) s++; return s; } }
const name = JSON.parse('"count"');
const out = text => JSON.parse(text);
const matrix = new Matrix(out('[[1,1]]'));
console.log(matrix[name]()); matrix.rows = out('["abc"]'); console.log(matrix[name]()); console.log(matrix.take(out('[[true],[true,true]]'))[name]()); matrix.rows = [new Uint8Array([1, 1, 0])]; console.log(matrix[name]());
