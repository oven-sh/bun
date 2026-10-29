// JSON.stringify of an object that holds itself throws a TypeError, however often it is asked and whatever the indent.
let thrown = 0;
for (let round = 0; round < 300; round++) {
  try {
    const it = { a: 1 };
    it.m = it;
    JSON.stringify(it, null, 2);
  } catch (error) {
    if (error instanceof TypeError) thrown++;
  }
}
console.log(thrown);
