// The operations behind Number, Buffer.byteLength and indexOf throw into a handler of the same function, and a finally block runs.
const box = JSON.parse('{"values":["12",7,null]}'); const odd = [Symbol("s"), { valueOf() { throw new RangeError("valueOf"); } }, 5n, {}];
function number(table, i) { let note = "none"; try { return "ok " + Number(table[i]); } catch (error) { note = error.name; return "caught " + note; } finally { log.push(note); } }
function size(table, i, encoding) { try { return "ok " + Buffer.byteLength(table[i], encoding); } catch (error) { return "caught " + error.code; } }
function find(text, table, i) { try { return "ok " + (typeof text === "string" ? text.indexOf(table[i], table[i]) : -2); } catch (error) { return "caught " + error.name; } }
const log = []; let lines = [];
for (let round = 0; round < 40; round++) {
  lines = []; log.length = 0;
  for (const table of [box.values, odd]) for (let i = 0; i < table.length; i++) lines.push(number(table, i), size(table, i, table[i]), find("a12b7", table, i));
}
console.log(lines.join("\n")); console.log(log.join());
