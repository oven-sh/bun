// An instance of a class below RegExp has a lastIndex, which the built-in class laid on it. An instance of another class that is defined by all its descriptors has it beside its own field.
class Pattern extends RegExp {}
class Target {
  kept = 1;
}
const names = ["lastIndex", "kept", "other"];
for (const name of names) {
  const found = Object.defineProperties(new Target(), Object.getOwnPropertyDescriptors(new Pattern("a")))[name];
  console.log(name, typeof found, found);
}
