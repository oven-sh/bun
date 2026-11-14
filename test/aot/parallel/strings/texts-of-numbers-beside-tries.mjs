// STATISTIC: NumberTextsHoisted >= 2
// The text of a number is made before its loop where the same handler is in force: no try, or one that holds the whole loop. A try inside the loop, a catch and a finally make it where it is used.
let failures = 0;
const fail = () => {
  if (failures++ % 4 === 2) throw new Error("failed");
};
function bare(mark, count) {
  let text = "";
  for (let i = 0; i < count; i++) text += mark;
  return text;
}
function around(mark, count) {
  let text = "";
  try {
    for (let i = 0; i < count; i++) {
      text += mark;
      fail();
    }
  } catch {
    text += "A";
  }
  return text;
}
function nestAround(mark, count) {
  let text = "";
  try {
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < 2; j++) text = mark + text;
      if (i === 3) fail();
    }
  } catch {
    text += "A";
  } finally {
    text += "Z";
  }
  return text;
}
function box(mark, width) {
  let text = "";
  for (let y = 0; y < 3; y++) {
    let line = y % 2 ? ">" : "";
    for (let x = 0; x < width; x++) {
      if ((x + y) % 3 === 0) line += mark;
      else line = x + line;
    }
    text += line + (y < 2 ? "/" : "");
  }
  return text;
}
function boxInTry(mark, width) {
  let text = "";
  try {
    for (let y = 0; y < 3; y++) {
      let line = y % 2 ? ">" : "";
      for (let x = 0; x < width; x++) {
        if ((x + y) % 3 === 0) line += mark;
        else line = x + line;
      }
      text += line;
      if (y === 1) fail();
    }
  } catch {
    text += "T" + mark;
  }
  return text;
}
function boxOfTries(mark, width) {
  let text = "";
  for (let y = 0; y < 3; y++) {
    let line = y % 2 ? ">" : "";
    for (let x = 0; x < width; x++) {
      try {
        if ((x + y) % 3 === 0) line += mark;
        else line = x + line;
        fail();
      } catch {
        line += "t" + mark;
      }
    }
    text += line;
  }
  return text;
}
function inside(mark, count) {
  let text = "";
  for (let i = 0; i < count; i++) {
    try {
      text += "t" + mark;
      fail();
      text += "n" + i;
    } catch {
      text += "c" + mark;
    }
  }
  return text;
}
function counted(mark, count) {
  let i = 0;
  let text = "";
  while (i++ < count) {
    try {
      const part = "k" + mark;
      text += part.length;
    } catch (error) {
      text += error.name;
    }
  }
  return text + i;
}
function deep(mark, count) {
  let text = "";
  outer: for (let i = 0; i < count; i++) {
    for (let j = 0; j < 3; j++) {
      try {
        text += mark;
        if (j === 1) continue outer;
        if (i === 4) break outer;
        fail();
      } catch {
        text += "L" + mark;
      } finally {
        text += "f" + mark;
      }
    }
  }
  return text;
}
function* steps(mark, count) {
  let text = "";
  for (let i = 0; i < count; i++) {
    try {
      text += "y" + mark;
      yield text.length;
    } finally {
      text += "F";
    }
  }
  return text;
}
async function waits(mark, count) {
  let text = "";
  for (let i = 0; i < count; i++) {
    try {
      await i;
      text += "w" + mark;
      fail();
    } catch {
      text += "c";
    }
  }
  return text;
}
function tested(mark, count) {
  let text = "";
  for (let i = 0; i < count; i++) {
    if (typeof mark === "number") text += mark;
    else if (typeof mark === "object") text += "o";
  }
  return text;
}
const said = [];
for (const mark of [0, 2.5, -0, NaN, 1e21, "s", "", null, undefined, true])
  for (const count of [0, 1, 5]) {
    said.push(bare(mark, count), around(mark, count), nestAround(mark, count), box(mark, count), boxInTry(mark, count), boxOfTries(mark, count));
    said.push(inside(mark, count), counted(mark, count), deep(mark, count), tested(mark, count));
    try {
      said.push([...steps(mark, count)].join(), await waits(mark, count));
    } catch (error) {
      said.push(error.name);
    }
  }
console.log(said.join("\n"));
