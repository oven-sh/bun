function oops(a) {
  expect(a).toMatchInlineSnapshot();
}
test("whoops", () => {
  oops(1);
  oops(2);
});
