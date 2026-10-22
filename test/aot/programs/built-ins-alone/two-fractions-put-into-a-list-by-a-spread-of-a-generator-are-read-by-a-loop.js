function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
for (const value of held) console.log(value + 1);
