// Alone: beside a program that names a standard stream the executable holds what makes the whole stream
// The program names no standard stream. Code evaluated at run time stores something else in Bun.file and then writes to a standard stream for the first time.
// What the stream writes to is not found through a name that a program can change. The answers are printed behind the last write: plain Bun writes later here.
const join = (...parts) => parts.join(process.argv.length > 99 ? "x" : "");
const text = `
  Bun.file = 1;
  const answers = [typeof Bun.file];
  return new Promise(resolve => {
    answers.push(process.std@out.write("the first write\\n"));
    answers.push(process.std@err.write(""));
    answers.push(process.std@out.write("the second\\n", () => resolve(answers)));
  });`;
new Function(join(...text.split("@")))().then(
  answers => console.log(answers.join(" ")),
  error => console.log("threw", error.constructor.name, error.message),
);
