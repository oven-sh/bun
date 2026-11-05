// A catch block or a finally block waits for something and then sets a variable of the function to undefined or null.
const said = [];
async function note(text) {
  said.push(text);
}

async function read(load) {
  let text = load();
  let size = 0;
  try {
    size = text.length;
    if (size > 3) throw new Error("long " + text);
  } catch (error) {
    await note(error.message);
    text = undefined;
  }
  await null;
  return size + " " + text;
}
console.log(await read(() => "abc"), "|", await read(() => "abcdef"), "|", await read(() => 7));

async function readWithFinally(load) {
  let text = load();
  let size = 0;
  try {
    size = text.length;
    if (size > 3) throw new Error("long " + text);
    return size + " " + text;
  } finally {
    await note("done " + size);
    text = null;
  }
}
const short = await readWithFinally(() => "abc");
console.log(short, "|", await readWithFinally(() => "abcdef").catch(error => error.message));

function* steps(load) {
  let text = load();
  let size = 0;
  try {
    size = text.length;
    if (size > 3) throw new Error("long " + text);
  } catch (error) {
    yield error.message;
    text = undefined;
  }
  yield size + " " + text;
}
console.log([...steps(() => "abc")].join("|"), "|", [...steps(() => "abcdef")].join("|"));

async function nested(load) {
  let text = load();
  let tries = 0;
  try {
    try {
      tries = text.length;
      if (tries > 3) throw new Error("inner " + text);
    } catch (error) {
      await note(error.message);
      if (tries > 5) throw new Error("outer " + text);
      text = undefined;
    }
  } catch (error) {
    await note(error.message);
    text = null;
  }
  await null;
  return tries + " " + text;
}
console.log(await nested(() => "abc"), "|", await nested(() => "abcd"), "|", await nested(() => "abcdef"));
console.log(said.join("|"));
