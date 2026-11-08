// `bun run` leaves the operand of `delete` as it is written, so a name in its dead zone is read.
const show = (name, probe) => {
  let answer;
  try {
    answer = String(probe(true));
  } catch (error) {
    answer = error.name;
  }
  console.log(name + ": " + answer);
};
show("and", flag => { const got = delete (late && flag); let late = 1; return "no throw " + got + late; });
show("a conditional", flag => { const got = delete (flag ? late : flag); let late = 1; return "no throw " + got + late; });
show("a comparison", flag => { const got = delete (late === flag); let late = 1; return "no throw " + got + late; });
show("a statement", flag => { delete (late && flag); let late = 1; return "no throw " + late; });
show("a parameter ahead of its turn", () => (function (a = delete (b && 1), b) { return "no throw " + a + b; })(undefined, 2));
show("a void that can be left out", () => { const got = delete void late; let late = 1; return "no throw " + got + late; });
show("initialized by then", flag => { let late = 1; return "no throw " + delete (late && flag); });
