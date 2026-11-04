// the receiver is an object of the program with a length and a charCodeAt of its own
class Tape {
  length = 3;
  charCodeAt(pos: number): number {
    return pos === 2 ? NaN : pos + 0.5;
  }
}
function codes(tape: Tape): string {
  let seen = "";
  for (let pos = 0; pos < tape.length; pos++) seen += tape.charCodeAt(pos) + ",";
  return seen;
}
function deed(): string {
  return codes(new Tape());
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
