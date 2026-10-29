// write() of a standard output with every kind of chunk, with callbacks, through variables, lists and functions, in order with console.log: as in a program that has the whole stream, and without it.
// STATISTIC: ImageFunctionsEmitted <= 220
for (const chunk of [1, null, undefined, {}, [], true, Symbol("s"), 10n, () => {}]) {
  try {
    console.log(process.stdout.write(chunk));
  } catch (error) {
    console.log(error.name, error.code, String(error.message).slice(0, 80));
  }
}
console.log(
  process.stdout.write(""),
  process.stdout.write(new Uint8Array([104, 105, 10])),
  process.stdout.write(new Uint8Array([111, 107, 10]).buffer),
  process.stdout.write("é\u{1f600}\n"),
  process.stdout.write("6869\n", "hex"),
);
process.stdout.write("a\n", () => console.log("called back"));
process.stdout.write("b\n", "utf8", error => console.log("called back", error));
try {
  process.stdout.write("c\n", () => {
    throw new Error("from the callback");
  });
} catch (error) {
  console.log("caught", error.message);
}
const chosen = process.argv.length > 5 ? process.stderr : process.stdout;
chosen.write("chosen " + chosen.fd + "\n");
for (const stream of [process.stdout, process.stdout]) stream.write("each " + stream.fd + "\n");
function say(stream, text) {
  return stream.write(text);
}
console.log(say(process.stdout, "passed\n"), { out: process.stdout }.out.write("held\n"));
const { isTTY, fd } = process.stdout;
console.log(isTTY === true, fd);
const write = process.stdout.write;
console.log(write.name, write.length, typeof write, write === process.stdout.write);
console.log("1");
process.stdout.write("2\n");
console.log("3");
process.stdout.write("4\n");
