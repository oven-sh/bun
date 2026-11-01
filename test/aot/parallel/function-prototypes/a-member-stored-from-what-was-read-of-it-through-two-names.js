// The way back leads through a second member and a second variable.
var holder = {};
const first = holder.second;
holder.first = first;
const second = holder.first;
holder.second = second;
function Base() {}
function Child() {}
for (const name of ["first", "second"]) {
  try {
    holder[name](Child, Base);
  } catch (error) {
    console.log(name, error.constructor.name);
  }
}
try {
  holder.first(Child, Base);
} catch (error) {
  console.log(error.constructor.name);
}
console.log(Object.keys(holder).join());
