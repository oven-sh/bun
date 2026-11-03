// A method of an object that others are put below is replaced by key, again and again. Between two replacements the objects below are turned into text and into numbers, which asks for the method each time.
const names = ["toString", "valueOf", "toJSON"];
function replace(holder, name, method) { holder[name] = method; }
function describe(object) { return `${object}` + "|" + (object * 2) + "|" + JSON.stringify({ object }); }
const methods = [];
for (let i = 0; i < 6; i++) methods.push(function () { return i; });

function inTurns(holder, below) {
  const lines = [];
  for (const name of names) replace(holder, name, methods[0]);
  for (let turn = 0; turn < 12; turn++) {
    for (const name of names) {
      // Twice, so that the second store finds the name where the first has left it.
      replace(holder, name, methods[turn % 6]);
      replace(holder, name, methods[turn % 6]);
    }
    lines.push(describe(below) + " " + describe(below));
    for (const name of names) replace(holder, name, methods[(turn + 1) % 6]);
    lines.push(describe(below));
  }
  return lines.join("\n");
}

const plain = {};
console.log(inTurns(plain, Object.create(plain)));

const wide = {};
for (let i = 0; i < 300; i++) wide["name" + i] = i;
console.log(inTurns(wide, Object.create(wide)));

class Below {}
console.log(inTurns(Below.prototype, new Below()));

const own = {};
console.log(inTurns(own, own));
