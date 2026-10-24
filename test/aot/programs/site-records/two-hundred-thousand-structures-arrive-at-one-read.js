// So many different ordinary structures arrive at one read, one store and one method call that their ids take on every pattern of bits. None of them is mistaken for the layout that the site expects, whatever part of the cell's header the test looks at.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler

class Expected {
  constructor(value) {
    this.first = "first of expected";
    this.wanted = value;
    this.last = "last of expected";
  }
  tell() {
    return "expected";
  }
}

function wantedOf(value) {
  return value.wanted;
}
function setWanted(value, to) {
  value.wanted = to;
}
function tell(value) {
  return value.tell();
}
function tellOther() {
  return "other";
}

const hide = unknown({ pass: value => value }).pass;
const honest = new Expected(-1);
let wrong = 0;
let sum = 0;
let kept = [];

for (let index = 0; index < 200000; index++) {
  const value = {};
  value["k" + index] = "not wanted";
  if (index & 1) value.pad = "not wanted either";
  value.wanted = index;
  value.tell = tellOther;
  const hidden = hide(value);
  const read = wantedOf(hidden);
  if (read !== index) wrong++;
  setWanted(hidden, index + 1);
  if (value.wanted !== index + 1 || value["k" + index] !== "not wanted" || Object.keys(value).length !== (index & 1 ? 4 : 3)) wrong++;
  if (tell(hidden) !== "other") wrong++;
  sum += read;
  kept.push(value);
  if ((index & 1023) === 0) {
    if (wantedOf(honest) !== -1 || tell(honest) !== "expected") wrong++;
    setWanted(honest, -1);
  }
  if (kept.length === 50000) {
    // Half of the structures stay alive, so that the ids in use keep spreading.
    kept = kept.filter((_each, place) => place & 1);
  }
}
console.log("wrong", wrong, "sum", sum, "kept", kept.length, JSON.stringify(honest));

export {};
