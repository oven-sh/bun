const log = [];
const note = value => {
  log.push(String(value));
  return value;
};
const show = object => JSON.stringify(object) + " " + Object.keys(object).join();

const atTopLevel = {};
atTopLevel.value = note(1);
atTopLevel.value = note(2);
atTopLevel.other = note(3);
atTopLevel.value = note(4);

function inFunction(seed) {
  const made = {};
  made.value = note(seed);
  made.value = note(seed + 1);
  made.other = note(seed + 2);
  made.value = note(seed + 3);
  return made;
}

function ofOtherKinds(seed) {
  const made = { value: 0 };
  made.value = note(seed);
  made.value = note("text" + seed);
  made.other = note(seed);
  made.value = note({ inner: seed });
  made.value = note(seed * 2);
  made.value = note(null);
  made.last = note(seed);
  return made;
}

function readsBetween(seed) {
  const made = {};
  made.value = note(seed);
  made.value = made.value + note(1);
  made.value = made.value * note(10);
  const seen = made.value;
  made.value = note(0);
  return [seen, made];
}

function handsOnBetween(seed, taker) {
  const made = {};
  made.value = note(seed);
  taker(made);
  made.value = note(seed + 1);
  made.value = note(seed + 2);
  return made;
}

function literalWithOneNameTwice(seed) {
  return { first: note(seed), second: note(seed + 1), first: note(seed + 2), third: note(seed + 3), second: note(seed + 4) };
}

function throwsBetween(seed) {
  const made = {};
  try {
    made.value = note(seed);
    made.value = note(seed + 1);
    made.value = seed.missing.deeper;
    made.value = note(seed + 2);
  } catch {
    made.caught = true;
  }
  return made;
}

class Holder {
  field = (() => {
    const made = {};
    made.value = note("a");
    made.value = note("b");
    return made;
  })();
  method(seed) {
    const made = { kept: this.field.value };
    made.kept = note(seed);
    made.kept = note(seed + "!");
    made.more = note(seed + "?");
    made.kept = note(seed + ".");
    return made;
  }
}

const below = Object.create({
  set value(given) {
    log.push("the setter takes " + given);
  },
});
below.value = note(1);
below.value = note(2);

let seenByTaker = "";
const results = [
  show(atTopLevel),
  show(inFunction(10)),
  show(inFunction(1.5)),
  show(ofOtherKinds(7)),
  JSON.stringify(readsBetween(3)),
  show(handsOnBetween(20, made => (seenByTaker += show(made)))),
  show(literalWithOneNameTwice(30)),
  show(throwsBetween(40)),
  show(new Holder().field),
  show(new Holder().method("m")),
  show(below),
  seenByTaker,
];
console.log(results.join("\n"));
console.log(log.join(" "));
