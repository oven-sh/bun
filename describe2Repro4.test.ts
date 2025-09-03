test.each([
  [1, 2, 3],
  [2, 3, 5],
  [4, 5, 9],
])("addition %i + %i = %i", (a, b, expected) => {
  console.log(a, b, expected);
  expect(a + b).toBe(expected);
});
