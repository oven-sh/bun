// Nine object types, each met first as the type of a field of the one before, and a generic type whose members are instances of itself that grow. Only four holders are looked at.
// Flags: --aot-limit=MaxHoldersFollowed:4
interface Level1 {
  name1: string;
  below1: Level2;
}
interface Level2 {
  name2: string;
  below2: Level3;
}
interface Level3 {
  name3: string;
  below3: Level4;
}
interface Level4 {
  name4: string;
  below4: Level5;
}
interface Level5 {
  name5: string;
  below5: Level6;
}
interface Level6 {
  name6: string;
  below6: Level7;
}
interface Level7 {
  name7: string;
  below7: Level8;
}
interface Level8 {
  name8: string;
  below8: Level9;
}
interface Level9 {
  name9: string;
  last: number | string;
}
interface Cell<T> {
  value: T;
  wrap(): Cell<Cell<T>> | null;
  inner: Cell<T[]> | null;
}
function cell<T>(value: T, depth: number): Cell<T> {
  return {
    value,
    wrap() {
      return depth > 0 ? cell(cell(value, 0), depth - 1) : null;
    },
    inner: depth > 0 ? cell([value], depth - 1) : null,
  };
}
function bottom(top: Level1): string {
  const l = top.below1.below2.below3.below4.below5.below6.below7.below8;
  return l.name9 + ":" + typeof l.last + ":" + l.last;
}
function parsed(text: string): Level1 {
  return JSON.parse(text);
}
let told = "";
for (const last of ["7", '"seven"']) {
  let text = '{"name9":"n9","last":' + last + "}";
  for (let level = 8; level >= 1; level--)
    text = '{"name' + level + '":"n' + level + '","below' + level + '":' + text + "}";
  told += bottom(parsed(text)) + "\n";
}
for (let depth = 0; depth < 4; depth++) {
  const c = cell(depth, depth);
  const w = c.wrap();
  told +=
    c.value +
    " " +
    (w ? typeof w.value.value + ":" + w.value.value : "none") +
    " " +
    (c.inner ? c.inner.value.length + ":" + c.inner.value[0] : "none") +
    "\n";
}
console.log(told);
