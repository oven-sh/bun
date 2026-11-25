// The executable holds the part of Bun's library that the program uses. Text that is decoded at run time is unknown to the compiler, and what it asks for may have been left out: the read is refused aloud, by the name of the member.
// A stand-in answered it once, in silence: `typeof process.finalization` was "function" where `bun <file>` says "object".
// A look that reads nothing still gets a stand-in: `in`, a descriptor, the names of the holder, and the printer, which goes through all members. For a function it knows the name, the length and whether there is a prototype. It knows nothing else, and of a value nothing at all, and says so.
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  return message.includes("bun compile differs from bun run here") ? "refused: " + message.split(" was not compiled")[0] : error.name;
}
function attempt(text) {
  try { console.log(text + ": " + (0, eval)(decoded(text))); } catch (error) { console.log(text + ": " + outcome(error)); }
}
attempt("typeof Bun.sql");
attempt("Bun.sql.name + Bun.sql.length");
attempt("typeof Bun.SQL.prototype");
attempt("'prototype' in Bun.sql");
attempt("new Bun.sql('postgres://localhost:1/none')");
attempt("typeof Bun.sql.unsafe");
attempt("'options' in Bun.sql");
attempt("Object.keys(Bun.sql).length");
attempt("Object.getOwnPropertyNames(Bun.sql).length");
attempt("typeof Object.getOwnPropertyDescriptor(Bun.sql, 'begin')");
attempt("Bun.sql[0]");
attempt("Object.hasOwn(Bun.SQL, 'MySQLError')");
attempt("typeof Bun.sql.call");
attempt("String(Bun.sql).length > 0");
attempt("typeof process.finalization");
attempt("typeof process.finalization.register");
attempt("process.finalization.name + process.finalization.length");
attempt("typeof process.allowedNodeEnvironmentFlags.has");
attempt("Bun.sql === Bun.sql");
attempt("Bun.sql instanceof Function");
attempt("Bun.inspect(Bun).length > 0");
attempt("'sql' in Bun");
attempt("typeof Object.getOwnPropertyDescriptor(Bun, 'SQL').value");
attempt("Object.getOwnPropertyDescriptor(Bun, 'SQL').value.name");
attempt("typeof Object.getOwnPropertyDescriptor(Bun, 'SQL').value.MySQLError");
console.log("the program goes on");
/* Output:
typeof Bun.sql: refused: Bun.sql
Bun.sql.name + Bun.sql.length: refused: Bun.sql
typeof Bun.SQL.prototype: refused: Bun.SQL
'prototype' in Bun.sql: refused: Bun.sql
new Bun.sql('postgres://localhost:1/none'): refused: Bun.sql
typeof Bun.sql.unsafe: refused: Bun.sql
'options' in Bun.sql: refused: Bun.sql
Object.keys(Bun.sql).length: refused: Bun.sql
Object.getOwnPropertyNames(Bun.sql).length: refused: Bun.sql
typeof Object.getOwnPropertyDescriptor(Bun.sql, 'begin'): refused: Bun.sql
Bun.sql[0]: refused: Bun.sql
Object.hasOwn(Bun.SQL, 'MySQLError'): refused: Bun.SQL
typeof Bun.sql.call: refused: Bun.sql
String(Bun.sql).length > 0: refused: Bun.sql
typeof process.finalization: refused: process.finalization
typeof process.finalization.register: refused: process.finalization
process.finalization.name + process.finalization.length: refused: process.finalization
typeof process.allowedNodeEnvironmentFlags.has: refused: process.allowedNodeEnvironmentFlags
Bun.sql === Bun.sql: refused: Bun.sql
Bun.sql instanceof Function: refused: Bun.sql
Bun.inspect(Bun).length > 0: true
'sql' in Bun: true
typeof Object.getOwnPropertyDescriptor(Bun, 'SQL').value: function
Object.getOwnPropertyDescriptor(Bun, 'SQL').value.name: SQL
typeof Object.getOwnPropertyDescriptor(Bun, 'SQL').value.MySQLError: refused: Bun.SQL
the program goes on
*/
