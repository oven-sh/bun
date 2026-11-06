// Iterator result is not an object: compiled answers as plain.
const bad = {
  [Symbol.iterator]() {
    return {
      next() {
        return 1;
      },
    };
  },
};
try {
  for (const v of bad);
} catch (e) {
  console.log(e.constructor.name);
}
try {
  const [x] = {};
} catch (e) {
  console.log(e.constructor.name);
}
try {
  [...null];
} catch (e) {
  console.log(e.constructor.name);
}
try {
  new Map([1]);
} catch (e) {
  console.log(e.constructor.name);
}
