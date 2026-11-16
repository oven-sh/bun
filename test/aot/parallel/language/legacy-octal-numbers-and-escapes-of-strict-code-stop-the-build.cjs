// A legacy octal number or escape in strict code is an early error: in a class, and under a "use strict" directive of a function. `bun <file>` reports each of these and runs nothing, and so does the build. The ones in the sloppy code between them are not errors.
console.log("never printed", 010, "\1");
class Strict {
  field = 011;
  "\2"() { return 08; }
  static [012]() { return "\8"; }
}
console.log(013, "\3");
function directive() {
  "\4";
  "use strict";
  return [014, "\105", 09.5, () => "\9"];
}
console.log(015, "\6", class extends (016, Object) {}, 017);
/* Build errors:
error: TS1121: Octal literals are not allowed. Use the syntax '0o11'.
error: TS1487: Octal escape sequences are not allowed. Use the syntax '\x02'.
error: TS1489: Decimals with leading zeros are not allowed.
error: TS1121: Octal literals are not allowed. Use the syntax '0o12'.
error: TS1488: Escape sequence '\8' is not allowed.
error: TS1487: Octal escape sequences are not allowed. Use the syntax '\x04'.
error: TS1121: Octal literals are not allowed. Use the syntax '0o14'.
error: TS1487: Octal escape sequences are not allowed. Use the syntax '\x45'.
error: TS1488: Escape sequence '\9' is not allowed.
error: TS1121: Octal literals are not allowed. Use the syntax '0o16'.
*/
