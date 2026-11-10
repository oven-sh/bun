const uses = {
  one(found) {
    return found.name;
  },
  two(found) {
    return found.name;
  },
};
const names = Object.keys(uses);
console.log("SAID", names.length, require(`./${names.length}.cjs`).name);
