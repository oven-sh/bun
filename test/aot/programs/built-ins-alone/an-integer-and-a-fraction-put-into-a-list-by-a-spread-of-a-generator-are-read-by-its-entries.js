function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
for (const [index, value] of held.entries()) console.log(index + 1, value + 1);
