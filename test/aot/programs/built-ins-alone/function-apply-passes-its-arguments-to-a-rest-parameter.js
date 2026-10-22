function target(...rest) {
  console.log(rest.length);
  console.log(typeof rest[0], rest[0] + 1);
  console.log(typeof rest[1], rest[1] + 1);
  console.log(typeof rest[2], rest[2].length);
  console.log(typeof rest[3], rest[3].four);
  console.log(typeof rest[4], rest[4]());
}
target.apply(undefined, [1, 2.5, "three", { four: 4 }, () => "five"]);
