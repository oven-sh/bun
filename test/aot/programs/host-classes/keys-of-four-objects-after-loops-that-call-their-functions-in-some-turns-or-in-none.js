// The same question for functions of four objects that are called in loops: String.fromCharCode, Number.isFinite, Date.now and Object.keys.
function text(codes) {
  let made = "";
  for (let index = 0; index < codes.length; index++) made += String.fromCharCode(codes[index]);
  return made;
}
function finite(numbers) {
  let count = 0;
  for (const number of numbers) if (Number.isFinite(number)) count++;
  return count;
}
function later(turns) {
  let last = 0;
  for (let turn = 0; turn < turns; turn++) last = Date.now() > 0 ? turn : -1;
  return last;
}
function names(objects) {
  let count = 0;
  for (let index = 0; index < objects.length; index++) count += Object.keys(objects[index]).length;
  return count;
}
const shown = [text([]), finite([]), later(0), names([])];
shown.push(String.raw`a`, Number.isNaN(1), Date.UTC(2000, 0), Object.values({ a: 1 }).length);
shown.push(text([97, 98, 99]), finite([1, Infinity, 3]), later(3), names([{ a: 1 }, { b: 2, c: 3 }]));
console.log(shown.join());
for (const object of [String, Number, Date, Object]) {
  console.log(Object.entries(object).length, Reflect.ownKeys(object).map(String).join());
}
