// `bun run` prints what opens the head as it is written, so the name is read, and the read throws.
const show = (name, probe) => {
  let answer;
  try {
    answer = String(probe(true));
  } catch (error) {
    answer = error.name;
  }
  console.log(name + ": " + answer);
};
let calls = 0;
const count = () => ++calls;
show("a name", flag => { for (late; flag; ) break; let late = 1; return "no throw " + late; });
show("a constant", flag => { for (late; flag; ) break; const late = 1; return "no throw " + late; });
show("a class", flag => { for (Late; flag; ) break; class Late {} return "no throw " + typeof Late; });
show("a conditional", flag => { for (late ? 1 : 2; flag; ) break; let late = 1; return "no throw " + late; });
show("a comparison", flag => { for (late === count(); flag; ) break; let late = 1; return "no throw " + late; });
show("a name that a closure holds", flag => { const read = () => late; for (late; flag; ) break; let late = 1; return "no throw " + read(); });
show("a name of the function around", flag => { const inner = () => { for (late; flag; ) break; return "no throw"; }; const got = inner(); let late = 1; return got + late; });
show("every other turn of 300", flag => { let thrown = 0; for (let turn = 0; turn < 300; turn++) { try { if (turn % 2) { for (late; flag; ) break; } let late = turn; } catch { thrown++; } } return thrown; });
show("initialized by then", flag => { let late = 1; for (late; flag; ) break; return "no throw " + late; });
console.log("calls: " + calls);
