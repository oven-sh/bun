const probe = {
  get [Symbol.match]() {
    console.log("match is read");
    return false;
  },
  toString() {
    console.log("toString");
    return "ban";
  },
};
console.log("banana".startsWith(probe), "banana".includes(probe), "banana".endsWith(probe));
