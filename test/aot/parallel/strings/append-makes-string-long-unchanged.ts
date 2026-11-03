// An append that would make a string longer than a string can be throws, and the catch goes on with the string as it was.
function makeLong(): string {
  let long = "0123456789abcdef".repeat(4096);
  for (let i = 0; i < 14; i++) long += long;
  return long;
}
function appendWhole(long: string, turns: number): string {
  let text = "",
    log = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += long;
      log += "+";
    } catch (e) {
      text += "T";
      log += (e as Error).name + ";";
    }
  }
  return text.length + " " + log;
}
function appendBehindShortPieces(long: string, turns: number): string {
  let text = "",
    log = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += "ab" + i + long + "c";
      log += "+";
    } catch (e) {
      log += text.length + ";";
      text += "T";
    }
  }
  return text.length + " " + log;
}
function appendInFinally(long: string, turns: number): string {
  let text = "",
    log = "";
  for (let i = 0; i < turns; i++) {
    try {
      try {
        text += long;
      } finally {
        text += "F";
      }
    } catch (e) {
      log += text.length + ";";
    }
  }
  return text.length + " " + log;
}
const long = makeLong();
console.log(long.length);
console.log(appendWhole(long, 5));
console.log(appendBehindShortPieces(long, 5));
console.log(appendInFinally(long, 5));
