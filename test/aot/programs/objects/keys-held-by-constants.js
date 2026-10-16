const ALPHA = "alpha";
const GAMMA = "gam" + "ma";
const DELTA = `del${"ta"}`;
const INDEX = "0";

function made() {
  return { alpha: 1, gamma(step) { return this.alpha + step; }, delta: 4, 0: "zero" };
}

function forms(x) {
  const read = x[ALPHA];
  x[ALPHA] = read + 1;
  x[ALPHA] += 1;
  x[ALPHA]++;
  const called = x[GAMMA](1);
  const chained = x?.[ALPHA];
  const deleted = delete x[DELTA];
  return [read, x.alpha, called, chained, deleted, "delta" in x, x[INDEX], typeof x[GAMMA]];
}
console.log(JSON.stringify(forms(made())));

function early() {
  try {
    return made()[LATE];
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(early());
const LATE = "alpha";
console.log(early());

function order() {
  const seen = [];
  try {
    (seen.push("object"), made())[LATER] = (seen.push("value"), 1);
  } catch (error) {
    seen.push(error.constructor.name);
  }
  return seen;
}
console.log(JSON.stringify(order()));
const LATER = "alpha";
console.log(JSON.stringify(order()));

let changing = "alpha";
function byAVariable(x) {
  return x[changing];
}
console.log(byAVariable(made()));
changing = "delta";
console.log(byAVariable(made()));
