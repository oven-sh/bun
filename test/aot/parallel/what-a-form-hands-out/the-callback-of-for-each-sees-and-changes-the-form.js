// forEach hands the value, the name and the form to the callback, with the second operand as `this`, and goes on over what the callback adds.
const form = new FormData();
form.append("a", "1");
form.append("b", new File(["x"], "b.txt"));
const receiver = { seen: [] };
let added = 0;
form.forEach(function (value, name, whole) {
  this.seen.push(`${name}=${typeof value}:${whole === form}`);
  if (added++ < 2) whole.append(`more${added}`, "x");
}, receiver);
console.log(`${receiver.seen.join(" ")} | ${form.length}`);
try {
  form.forEach(() => {
    throw new RangeError("thrown by the callback");
  });
} catch (error) {
  console.log(error.message);
}
for (const callback of [undefined, {}, "text"]) {
  try {
    form.forEach(callback);
  } catch (error) {
    console.log(`${error.name} ${error.code}`);
  }
}
