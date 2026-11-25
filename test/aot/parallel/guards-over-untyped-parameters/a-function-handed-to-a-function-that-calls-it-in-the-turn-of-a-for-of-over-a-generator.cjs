const printValue = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
let heard1 = 0;
function* parts1(count) { for (const value of inner1(count)) yield value; }
function* inner1(count) { yield {}; for (let i = 0; i < count; i++) yield i; }
function run1(mark, hook) {
  var b = 0;
  let same = -1;
  let i = -1;
  for (const x of parts1(4)) {
    i++;
    if (b !== mark) same = i;
    b = i < 2 ? i : mark;
    same += b === mark ? 1 : 0;
    hook(i);
  }
  return [typeof b, String(b), same, String(mark)].join("|");
}
const hook1 = (value) => value;
for (let round = 0; round < 40; round++) {
  {
    const made = parts1(4);
    let said;
    try { said = run1(JSON.parse("null"), hook1); } catch (error) { said = (error).name; }
    if (round < 2) printValue("loop 1", said, "", heard1);
  }
  {
    const made = parts1(4);
    let said;
    try { said = run1(JSON.parse("null"), hook1); } catch (error) { said = (error).name; }
    if (round < 2) printValue("loop 1", said, "", heard1);
  }
  {
    const made = parts1(4);
    let said;
    try { said = run1(JSON.parse("null"), hook1); } catch (error) { said = (error).name; }
    if (round < 2) printValue("loop 1", said, "", heard1);
  }
  {
    const made = parts1(4);
    let said;
    try { said = run1(JSON.parse("null"), hook1); } catch (error) { said = (error).name; }
    if (round < 2) printValue("loop 1", said, "", heard1);
  }
}
