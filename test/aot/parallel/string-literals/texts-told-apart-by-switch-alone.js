// A text from outside is told apart by the cases of a switch, which spell texts that the program spells nowhere else. Behind a case it is still that text: it has its length, equals a text made of the same characters, and is the key it was.
function lengthOf(name) {
  switch (name) {
    case "dir":
    case "role":
    case "viewBox":
      return name.length;
  }
  return -1;
}
function isSame(name, other) {
  switch (name) {
    case "width":
    case "height":
      switch (other) {
        case "width":
        case "height":
        case "depth":
          return name === other;
      }
  }
  return "neither";
}
function countOf(object, name) {
  let count = 0;
  switch (name) {
    case "left":
    case "right":
      for (const key in object) if (key === name) count++;
  }
  return count;
}
function joined(name) {
  switch (name) {
    case "north":
    case "south":
      return name + "!" + `${name}` + [name].join();
  }
  return "";
}
const parsed = JSON.parse('["dir","role","viewBox","other","width","height","depth","left","right","north","south"]');
const made = parsed.map(text => (text + "!").slice(0, -1));
const lines = [];
for (let round = 0; round < 30; round++) {
  const line = [];
  for (const list of [parsed, made]) {
    for (const text of list) line.push(lengthOf(text), joined(text), countOf({ left: 1, right: 2, up: 3 }, text));
    for (const text of list) for (const other of made) line.push(isSame(text, other));
  }
  if (round === 0 || round === 29) lines.push(line.filter(part => part !== "neither" && part !== "" && part !== -1 && part !== 0).join());
}
console.log(lines[0]);
console.log(lines[0] === lines[1]);
