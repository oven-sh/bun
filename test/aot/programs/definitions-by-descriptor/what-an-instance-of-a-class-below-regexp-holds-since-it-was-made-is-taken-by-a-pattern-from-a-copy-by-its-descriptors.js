// An instance of a class below RegExp has a lastIndex, which the built-in class laid on it. An object that is defined by all its descriptors has it too, and a pattern with a computed key takes it.
class Pattern extends RegExp {}
const names = ["lastIndex", "other"];
for (const name of names) {
  const { [name]: found } = Object.defineProperties({}, Object.getOwnPropertyDescriptors(new Pattern("a")));
  console.log(name, typeof found, found);
}
