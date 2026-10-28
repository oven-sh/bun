// An object that is defined by all the descriptors of a list that a built-in made has its length. A read under a computed key answers what is there, and a call of what is no function throws.
const names = ["length", "other"];
const copy = () => Object.defineProperties({}, Object.getOwnPropertyDescriptors("a,b".split(",")));
for (const name of names) {
  const found = copy()[name];
  console.log(name, typeof found, found);
  try {
    console.log(found?.(0));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
