function* parts1(count) { for (const value of inner1(count)) yield value; }
function* inner1(count) { yield {}; for (let i = 0; i < count; i++) yield i; }
function run1(mark, hook) {
  var b = 0;
  let i = -1;
  for (const x of parts1(4)) {
    i++;
    if (b !== mark) same = i;
    b = i < 2 ? i : mark;
    hook(i);
  }
}
const hook1 = (value) => value;
for (let round = 0; round < 40; round++) {
  {
    const made = parts1(4);
    said = run1(JSON.parse("null"), hook1);
  }
  {
  }
  {
  }
  {
  }
}
