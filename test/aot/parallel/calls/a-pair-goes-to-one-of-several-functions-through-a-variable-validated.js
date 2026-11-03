// A pair that nobody changes or keeps is handed to one of several functions through a variable, in a build that checks itself while it runs: an array that lies in a frame stops the program where it reaches anything but a read.
// Flags: --aot-validate
const lines = [];
const index = Number(process.argv.length > 99);
const show = (name, ...values) =>
  lines.push(
    name + " " + values.map(value => (typeof value === "string" ? JSON.stringify(value) : String(value))).join(" "),
  );

const apart = pair => {
  const [x, y] = pair;
  return [x, y, typeof x, typeof y];
};
const walked = pair => {
  const out = [];
  for (const [k, v] of [pair]) out.push(k, v, typeof k, typeof v);
  return out;
};
const byIndex = pair => [pair[0], pair[1], typeof pair[0], typeof pair[1]];
const byIndexNobodyKnows = pair => [pair[index], pair[index + 1], typeof pair[index], typeof pair[index + 1]];
const byRest = pair => {
  const [...all] = pair;
  return [all[0], all[1], typeof all[0], typeof all[1], all.length];
};
const behindOnePlace = pair => {
  const [x, ...rest] = pair;
  return [x, rest[0], typeof x, typeof rest[0], rest.length];
};

function eachTakesThePair() {
  for (const take of [apart, walked, byIndex, byIndexNobodyKnows, byRest, behindOnePlace]) {
    const pair = ["abc", 7];
    let taken;
    try {
      taken = take(pair);
    } catch (error) {
      taken = [error.constructor.name];
    }
    show(take.name, ...taken, pair.length);
  }
}

const withOthers = (pair, ...others) => [pair[0], pair[1], others.length];
const withOthersApart = (pair, ...others) => {
  const [x, y] = pair;
  return [y, x, others.length, others[0]];
};
const withOthersCounted = (pair, ...others) => [pair.length + others.length, pair[index]];
const withOthersLast = (pair, ...others) => [others[others.length - 1], pair[1]];

function eachTakesThePairAndOthers() {
  for (const take of [withOthers, withOthersApart, withOthersCounted, withOthersLast]) {
    const pair = ["def", 8];
    let taken;
    try {
      taken = take(pair, 1, "two");
    } catch (error) {
      taken = [error.constructor.name];
    }
    show(take.name, ...taken, pair.length);
  }
}

function firstOfThis() {
  return [this[0], typeof this[0]];
}
function secondOfThis() {
  return [this[1], typeof this[1]];
}
function bothOfThis() {
  const [x, y] = this;
  return [y, x];
}
function lengthOfThis() {
  return [this.length, this[index]];
}

function eachTakesThePairAsThis() {
  for (const take of [firstOfThis, secondOfThis, bothOfThis, lengthOfThis]) {
    const pair = ["ghi", 9];
    let taken;
    try {
      taken = take.call(pair);
    } catch (error) {
      taken = [error.constructor.name];
    }
    show(take.name, ...taken, pair.length);
  }
}

const kept = [];
const keeps = pair => {
  kept.push(pair);
  return [pair[0], pair[1]];
};
const returns = pair => pair;

function someKeepThePair() {
  for (const take of [apart, byIndex, keeps, byRest, returns, behindOnePlace]) {
    const pair = ["jkl", 10];
    let taken;
    try {
      taken = take(pair);
    } catch (error) {
      taken = [error.constructor.name];
    }
    show(take.name, ...taken, pair.length);
  }
  show("kept", kept.length, ...kept[0]);
}

eachTakesThePair();
eachTakesThePairAndOthers();
eachTakesThePairAsThis();
someKeepThePair();
console.log(lines.join("\n"));
