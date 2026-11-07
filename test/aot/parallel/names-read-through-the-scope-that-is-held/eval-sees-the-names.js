function make(skip, text) {
  let at = 0;
  return { run: code => eval(code), step: () => (at++, skip) };
}
const made = make("s", "t");
console.log(made.step(), made.run("skip + text + at"), made.run("skip = 'z'; at = 9"), made.step(), made.run("at"));
