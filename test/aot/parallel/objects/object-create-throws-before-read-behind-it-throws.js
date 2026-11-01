// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// Object.create(x) throws its TypeError for an x that is no object, and not the one of the read of a member of null that computes the first stored value.
function make(proto, from) {
  const made = Object.create(proto);
  made.items = from.count;
  return made;
}
const prototypes = [{ kind: "above" }, 1];
const sources = [{ count: 3 }, null];
for (let index = 0; index < 2; index++) {
  try {
    console.log(make(prototypes[index], sources[index]).items);
  } catch (e) {
    console.log(e.constructor.name, e.message);
  }
}
