// The later definition wins: two getters, a getter over a value, a value over a getter, and a getter under a computed key that is the same name.
function read(object) { return object.value; }
function main() {
  const name = "value";
  const twice = { get value() { return 1; }, get value() { return 2; } };
  const overValue = { value: 3, get value() { return 4; } };
  const underValue = { get value() { return 5; }, value: 6 };
  const computed = { get value() { return 7; }, get [name]() { return 8; } };
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += read(twice) + 10 * read(overValue) + 100 * read(underValue) + 1000 * read(computed);
  console.log(sum);
}
main();
