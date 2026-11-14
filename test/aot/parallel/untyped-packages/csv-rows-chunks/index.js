// comma separated rows with quotes, delimiters found by counting, headers, casts and a writer
'use strict';
function Parser(o) { o = o || {}; this.delimiter = o.delimiter; this.header = o.header; this.cast = o.cast; this.trim = !!o.trim; this.relax = !!o.relax; this.comment = o.comment; this.rows = []; this.row = []; this.field = ''; this.quoted = false; this.wasQuoted = false; this.line = 1; this.errors = []; this.rest = ''; }
Parser.prototype.guess = function (text) { var best = ',', most = 0, inQ = false, counts = {}; for (var i = 0; i < text.length; i++) { var c = text[i]; if (c === '"') inQ = !inQ; else if (!inQ && (c === ',' || c === ';' || c === '\t' || c === '|')) { counts[c] = (counts[c] || 0) + 1; if (counts[c] > most) { most = counts[c]; best = c; } } else if (c === '\n' && !inQ) break; } return best; };
Parser.prototype.endField = function () {
  var v = this.trim && !this.wasQuoted ? this.field.trim() : this.field;
  if (this.cast && !this.wasQuoted) { if (v === '') v = null; else if (/^-?\d+$/.test(v) && Math.abs(v) < 9e15) v = parseInt(v, 10); else if (/^-?\d*\.\d+(?:e[+-]?\d+)?$/i.test(v)) v = parseFloat(v); else if (v === 'true' || v === 'false') v = v === 'true'; }
  this.row.push(v); this.field = ''; this.wasQuoted = false;
};
Parser.prototype.endRow = function () {
  this.endField();
  var row = this.row; this.row = [];
  if (row.length === 1 && (row[0] === '' || row[0] === null)) return;
  if (this.header === true) { this.header = row.map(function (n, i) { return n === null ? 'column' + i : String(n); }); return; }
  if (Array.isArray(this.header)) { if (row.length !== this.header.length && !this.relax) { this.errors.push(this.line + ': ' + row.length + ' for ' + this.header.length); return; } var o = {}; for (var i = 0; i < this.header.length; i++) o[this.header[i]] = row[i]; this.rows.push(o); } else this.rows.push(row);
};
Parser.prototype.write = function (chunk) {
  if (this.delimiter === undefined) this.delimiter = this.guess(chunk);
  var s = this.rest + chunk, d = this.delimiter; this.rest = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (this.quoted) { if (c === '"') { if (i + 1 === s.length) { this.rest = '"'; return this; } if (s.charAt(i + 1) === '"') { this.field += '"'; i++; } else this.quoted = false; } else { this.field += c; if (c === '\n') this.line++; } continue; }
    if (this.comment && c === this.comment && this.field === '' && this.row.length === 0) { var e = s.indexOf('\n', i); if (e < 0) { this.rest = s.slice(i); return this; } i = e; this.line++; continue; }
    if (c === '"' && this.field.trim() === '') { this.quoted = this.wasQuoted = true; this.field = ''; }
    else if (c === d) this.endField();
    else if (c === '\n') { this.endRow(); this.line++; }
    else if (c !== '\r') this.field += c;
  }
  return this;
};
Parser.prototype.end = function (chunk) { if (chunk) this.write(chunk); if (this.rest === '"') { this.quoted = false; this.rest = ''; } if (this.quoted) this.errors.push('open quote'); if (this.field !== '' || this.row.length) this.endRow(); return this.rows; };
exports.Parser = Parser;
exports.parse = function (t, o) { var p = new Parser(o); var r = p.end(t); r.errors = p.errors; return r; };
exports.write = function (rows, o) { o = o || {}; var d = o.delimiter || ',', cols = o.columns || (Array.isArray(rows[0]) ? null : Object.keys(rows[0] || {})), q = new RegExp('["\\n\\r' + d.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&') + ']|^\\s|\\s$'); function cell(v) { if (v === null || v === undefined) return ''; var s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v); return q.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; } var out = cols ? [cols.map(cell).join(d)] : []; for (var i = 0; i < rows.length; i++) out.push((cols ? cols.map(function (c) { return rows[i][c]; }) : rows[i]).map(cell).join(d)); return out.join('\n'); };
