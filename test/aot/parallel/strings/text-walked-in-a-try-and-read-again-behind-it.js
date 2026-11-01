// Flags: --aot-check=verify-each-stage
// A text is walked by a loop in one try block and taken apart in the next: what the loop has prepared in front of itself is not at hand behind its catch clause.
var one, tail, table, seen = 0, log = [];
function walk(given) {
  try {
    given = "replaced";
  } catch (error) { log.push("first " + error.name); }
  try {
    for (one of given)
      seen++;
  } catch (error) { log.push("second " + error.name); }
  try {
    [tail] = given;
  } catch (error) { log.push("third " + error.name); }
  return given;
}
function codes(text, limit) {
  let sum = 0;
  try {
    for (let i = 0; i < limit; i++) sum += text.charCodeAt(i);
  } catch (error) {
    sum = -1;
  }
  return sum + " " + text.charCodeAt(0) + " " + text.length;
}
table = walk;
for (const value of ["abc", [1, 2], null, undefined, 5, { a: 1 }]) log.push(String(table(value)) + " " + one + " " + tail + " " + seen);
for (const text of ["", "a", "abc", "ab" + String(seen) + "cd".repeat(3)]) log.push(codes(text, 0) + " | " + codes(text, 2) + " | " + codes(text, 40));
console.log(log.join("\n"));
