// A function makes a text that is too long and catches the error, in the last frames that fit on the stack.
let depth = 0;
let first = Infinity;
let caught = 0;

function makeTextTooLong(text: string): number {
  try {
    return text.repeat(2 ** 31).length;
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Out of memory") caught++;
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

// The first call of a function may compile it, which takes more of the stack than a later call.
console.log(makeTextTooLong("ab"));
first = countLevels() - 40;
countLevels();
console.log(caught > 1);
