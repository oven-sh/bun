// A function makes a text that is too long and catches the error, in the last frames that fit on the stack.
let depth = 0;
let first = Infinity;
let message = "";

function makeTextTooLong(text: string): number {
  try {
    return text.repeat(2 ** 31).length;
  } catch (error) {
    message = (error as Error).message;
    return message.length;
  }
}

function descend(text: string): number {
  depth++;
  const length = depth >= first ? makeTextTooLong(text) : 0;
  return descend(text) + length;
}

function countLevels(): number {
  depth = 0;
  try {
    descend("ab");
  } catch (error) {
    console.log((error as Error).name);
  }
  return depth;
}

for (let turn = 0; turn < 4; turn++) first = countLevels() - 40;
console.log(message);
