// `bun run` writes `undefined` for `void x` where it could leave all of `x` out. Otherwise it leaves `x` as it is written, and a name in its dead zone is read.
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
show("a comparison with a call", () => { const got = void (late === count()); let late = 1; return "no throw " + got + late; });
show("a conditional with a call", flag => { const got = void (flag ? late : count()); let late = 1; return "no throw " + got + late; });
show("the body of an arrow", () => { const got = (() => void (late === count()))(); let late = 1; return "no throw " + got + late; });
show("what a function returns", () => { const got = (function () { return void (late === count()); })(); let late = 1; return "no throw " + got + late; });
show("the last part of the head of a for", () => { for (let i = 0; i < 1; void (late === count())) i++; let late = 1; return "no throw " + late; });
show("all of it can be left out", () => { const got = [void late, void !late, void (late === 1)]; let late = 1; return "no throw " + got + late; });
show("a statement", () => { void (late === count()); let late = 1; return "no throw " + late; });
console.log("calls: " + calls);
