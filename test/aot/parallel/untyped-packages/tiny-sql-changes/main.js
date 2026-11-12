// An untyped package and a program of it (changes): tables queried by text: a lexer, a parser, joins, groups, orders, indexes and transactions
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var db = new lib(), steps = ['CREATE TABLE t (k INT UNIQUE, v TEXT, x REAL)', "INSERT INTO t VALUES (1, 'a', 1.5), (2, 'b', NULL), (3.9, 'c', '7')", 'BEGIN', 'UPDATE t SET x = x * 2, v = CONCAT(v, k) WHERE k > 1', "INSERT INTO t VALUES (1, 'dup', 0)", 'ROLLBACK', 'DELETE FROM t WHERE x IS NULL', 'BEGIN', 'BEGIN', "INSERT INTO t (v) VALUES ('only')", 'COMMIT', 'UPDATE t SET k = k + 10', 'ROLLBACK', 'ROLLBACK', 'INSERT INTO t VALUES (9)', 'DELETE FROM t', "INSERT INTO t VALUES (5, 'z', -0.5)", 'DROP t']; steps.forEach(function (s, i) { var r; try { r = db.run(s); } catch (e) { r = e.name + ' ' + e.message; } var all; try { all = JSON.stringify(db.run('SELECT * FROM t ORDER BY k')); } catch (e) { all = e.message; } say(i, r, all, db.saved.length); });
