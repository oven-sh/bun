const keys = ["alpha", "beta", "gamma", "delta"];
const others = ["beta", "gamma", "delta", "alpha"];
const inherited = { gamma: "from the prototype" };

function defineAndRead(i) {
  const key = keys[i & 3];
  const entry = { [key]: i, fixed: 1 };
  return entry[key] + entry.fixed;
}

function readAnother(i) {
  const entry = { [keys[i & 3]]: i, fixed: 1 };
  return entry[others[i & 3]];
}

function readInherited(i) {
  const entry = { fixed: i };
  Object.setPrototypeOf(entry, inherited);
  return entry[keys[i & 3]];
}

function storeLater(i) {
  const entry = { fixed: i };
  const key = keys[i & 3];
  const before = entry[key];
  entry[key] = i * 2;
  return [before, entry[key], Object.keys(entry).join()];
}

function readPastTheEnd(i) {
  const entry = { undefined: "under undefined", fixed: i };
  return entry[keys[i & 7]];
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += defineAndRead(i);
console.log(sum);
for (let i = 0; i < 8; i++)
  console.log(i, defineAndRead(i), readAnother(i), readInherited(i), JSON.stringify(storeLater(i)), readPastTheEnd(i));
