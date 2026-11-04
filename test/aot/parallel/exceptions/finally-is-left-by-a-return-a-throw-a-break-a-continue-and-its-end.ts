// one finally block is come to by a return, a throw, a break, a continue and the end of its try, and each goes on its own way behind it
let released = 0;
function subject(how: number) {
  let turns = "";
  for (let i = 0; i < 3; i++) {
    try {
      if (how === 0 && i === 1) return "returned" + turns;
      if (how === 1 && i === 1) throw new Error("thrown" + turns);
      if (how === 2 && i === 1) break;
      if (how === 3 && i === 1) continue;
      turns += String(i);
    } finally {
      released++;
      turns += "f";
    }
  }
  return "ended" + turns;
}
function deed(how: number) { try { return subject(how) + String(released); } catch (e) { return (e as Error).message + String(released); } }
console.log(deed(0), deed(1), deed(2), deed(3), deed(4));
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += deed(i % 5).length;
console.log(String(lengths), String(released));
console.log(deed(JSON.parse("1")), deed(JSON.parse("0")));
