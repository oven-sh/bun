let list = [3, 1, 2];
function work(state) {
  for (let i = 40; i > 0; i -= 3) {
    const part = () => {
      list[i] = state.b;
    };
    part();
    list[i] = state.b;
  }
}
for (const n of [3, 5]) {
  try {
    work({ b: 0.5 });
  } catch (error) {}
}
const other = { b: 0.5 };
other.b = JSON.parse('"s"');
console.log(other.b);
