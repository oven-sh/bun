var foo = true;

if (true) {
  var { foo } = { foo: false };
}

export function test() {
  console.assert(foo === false, "foo should be false");
  return testDone(import.meta.url);
}
