// A class in a file without types: a constructor's parameter fills the field, so nothing is written of it; what the class's own methods do with `this.<name>` gives the field a word, as a parameter's uses give the parameter one. The word is expected alone: every read is guarded at the run. The data comes out of a text. `this.rows[r][c]`: a list of lists or texts, by its uses.
class Matrix { constructor(rows) { this.rows = rows; } count() { let s = 0; for (let r = 0; r < this.rows.length; r++) for (let c = 0; c < this.rows[r].length; c++) if (this.rows[r][c]) s++; return s; } }
const name = JSON.parse('"count"');
const out = text => JSON.parse(text);
for (let turn = 0; turn < 2; turn++) for (const text of ['[[true,false,true],[false,true]]', '[[1,0,2],[0]]', '[[0.5,0,null]]', '[["a",""],[""]]', '["ab",[1]]', '[]', '[[]]']) console.log(new Matrix(out(text))[name]());
