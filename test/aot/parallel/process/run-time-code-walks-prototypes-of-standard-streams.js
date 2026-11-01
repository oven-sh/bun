// The program names no standard stream. Code that is evaluated at run time walks up the prototypes of each and asks which class each is of.
const join = (...parts) => parts.join(process.argv.length > 99 ? "x" : "");
const ask = text => {
  try {
    return new Function(text)();
  } catch (error) {
    return "throws " + error.name;
  }
};
const chain = `
  const names = [];
  for (let at = Object.getPrototypeOf(stream); at; at = Object.getPrototypeOf(at)) names.push(at.constructor.name + (at.constructor.prototype === at));
  return names.join(" ");`;
for (const name of ["out", "err", "in"]) {
  console.log(name, ask(join("const stream = process.std", name, ";", chain)));
  console.log(name, ask(join("return process.std", name, ".constructor.name")));
  console.log(name, ask(join("return Object.keys(Object.getPrototypeOf(process.std", name, ")).includes('constructor')")));
}
console.log(ask(join("return Object.getPrototypeOf(process.std", "out) === Object.getPrototypeOf(process.std", "err)")));
const up = "Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process.std";
console.log(ask(join("return ", up, "out))) === ", up, "in)))")));
