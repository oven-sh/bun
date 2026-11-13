// Flags: --aot-harden=proof-checks
// String.fromCharCode(x) takes the code unit of x; the handler around it still reads x.
console.log(new Map([["constructor", 1]]).size);
const log = [];
function scan(list) {
  let text = "";
  try {
    for (let i = 0; i < list.length; i++) {
      var unit = list[i];
      if (unit >= 5760) text += String.fromCharCode(unit);
      else text += String.fromCharCode(unit) + "|";
    }
  } catch (error) {
    log.push(error.message, String(unit));
  } finally {
    log.push(typeof unit, text.length);
  }
  return text;
}
function next() {
  try {
    while (this.left--) {
      var unit = this.pos;
      switch (unit) {
        case 32: case 160: case 13: this.blank++;
        default: unit >= 5760 && (this.last = String.fromCharCode(unit));
      }
    }
  } catch (error) {
    log.push(error.message, String(unit));
  }
  return [unit, this.last, this.blank];
}
const bad = { valueOf() { throw new Error("no number"); } };
for (let turn = 0; turn < 4; turn++) {
  log.push(scan([65, 70000, 5760, 1.5, -1]), scan([65, "66", undefined, null, true]), scan([65601, bad, 67]));
  log.push(next.call({ left: 5, pos: 32, blank: 0, last: "" }), next.call({ left: 3, pos: 70001, blank: 0, last: "" }), next.call({ left: 3, get pos() { return this.left ? 6000 : bad; }, blank: 0, last: "" }));
}
console.log(JSON.stringify(log));
