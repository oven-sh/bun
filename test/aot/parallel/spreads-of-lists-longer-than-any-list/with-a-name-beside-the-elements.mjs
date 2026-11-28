// A list whose length no list can have, and which holds a name beside its elements, is refused before its elements are stepped over.
const refused = spread => {
  try {
    return spread();
  } catch (error) {
    return error.name;
  }
};
const sparse = [1, 2, 3];
sparse["-1"] = 7;
sparse[4294967292] = 5;
const count = (...all) => all.length;
console.log(sparse.length, refused(() => [...sparse].length), refused(() => [0, ...sparse].length), refused(() => count(...sparse)), refused(() => Math.max(...sparse)));

const short = [1, 2];
short[100000] = 3;
short["-1"] = 2;
console.log([...short].length, [...short][100000], [...short][50]);

// What the program iterates itself is stepped, however long it is.
const own = [1];
own[4294967290] = 2;
own[Symbol.iterator] = function* () {
  yield 9;
};
console.log([...own].join());
class Pair extends Array {
  *[Symbol.iterator]() {
    yield 1;
    yield 2;
  }
}
const pair = new Pair();
pair[4294967290] = 1;
console.log([...pair].length);
