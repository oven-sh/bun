function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
for (const value of held) console.log(value + 1);
