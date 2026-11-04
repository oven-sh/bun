function make(name) {
  const made = {};
  made[name] = 0;
  return made;
}
const other = make("other");
let text = "";
for (let i = 0; i < 3; i++) {
  const object = make("added");
  text += Object.keys(object).join() + i + " ";
}
console.log(text, typeof other);
