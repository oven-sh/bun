// An error message quotes source text only from the frame that raised the error. Compiled code has no text to quote, so its message must not quote a caller that was created from text. Constant text given to `new Function` is compiled with the program, so that caller quotes nothing either, where under plain Bun it quotes itself.
function messageOf(run) {
  try {
    run();
  } catch (error) {
    return error instanceof TypeError ? error.message : "not a TypeError";
  }
  return "no error";
}
const callsFromText = new Function("callback", "return callback()");
const cases = [
  ["new Math.max()", () => [new Math.max()], new Function("return new Math.max()")],
  ["new Symbol()", () => [new Symbol()], new Function("return new Symbol()")],
];
for (const [text, raise, raiseInText] of cases) {
  const calledFromText = messageOf(() => [callsFromText(raise)]);
  const raisedInText = messageOf(() => [raiseInText()]);
  console.log(`${text}: quotes its caller ${calledFromText.includes("callback")}, text quotes itself ${raisedInText.includes(text)}`);
}
