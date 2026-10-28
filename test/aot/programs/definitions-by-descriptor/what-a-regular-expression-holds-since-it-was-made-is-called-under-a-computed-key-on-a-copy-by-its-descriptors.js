// An object that is defined by all the descriptors of a regular expression has its lastIndex. A read under a computed key answers what is there, and a call of what is no function throws.
const names = ["lastIndex", "other"];
const copy = () => Object.defineProperties({}, Object.getOwnPropertyDescriptors(/a+/gi));
for (const name of names) {
  const found = copy()[name];
  console.log(name, typeof found, found);
  try {
    console.log(found?.(0));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
