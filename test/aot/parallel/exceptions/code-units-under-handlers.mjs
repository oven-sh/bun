// Flags: --aot-harden=proof-checks
// String.fromCharCode(x) takes the code unit of x; the handler around it still reads x.
console.log(new Map([["constructor", 1]]).size);
const log = [];
function scan(list) {
  let text = "";
  try {
    for (let i = 0; i < list.length; i++) {
      var unit = list[i];
      if (unit > 5000) text += String.fromCharCode(unit);
      else text += String.fromCharCode(unit) + "|";
    }
  } catch (error) {
    log.push(error.message, String(unit));
  } finally {
    log.push(typeof unit, text.length);
  }
  return text;
}
function draw() {
  try {
    for (let turns = this.turns; turns > 0; turns = this.turns -= 1) {
      var bead = this.bead;
      if (bead > 5000) this.sign = String.fromCharCode(bead);
      else if (bead === 41 || bead === 77) this.plain += 2;
      else this.plain += 1;
    }
  } catch (error) {
    log.push(error.message, String(bead));
  }
  return [this.plain, bead, this.sign];
}
const bad = { valueOf() { throw new Error("no number"); } };
for (let turn = 0; turn < 4; turn++) {
  log.push(scan([65, 70000, 5001, 1.5, -1]), scan([65, "66", undefined, null, true]), scan([65601, bad, 67]));
  log.push(draw.call({ turns: 5, bead: 41, plain: 0, sign: "" }), draw.call({ turns: 3, bead: 70001, plain: 0, sign: "" }), draw.call({ turns: 3, get bead() { return this.turns > 1 ? 6000 : bad; }, plain: 0, sign: "" }));
}
console.log(JSON.stringify(log));
