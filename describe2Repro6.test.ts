// this test should fail despite being 'test.failing', matching existing behaviour
// we might consider changing this.
test.failing("expect.assertions", () => {
  expect.assertions(1);
  expect.hasAssertions();
});

// these tests are expected to pass (because they failed) because expect.hasAssertions is not yet supported in concurrent tests
test.concurrent.failing("expect.assertions concurrent", () => {
  expect.hasAssertions();
});
test.concurrent.failing("expect.assertions concurrent", () => {
  expect.assertions(1);
});
