// `const kept = holder.name; holder.name = kept;`: whoever follows the name to what it stands for comes back to where he began.
var holder = { other: 1 };
const kept = holder.link;
holder.link = kept;
function Base() {}
function Child() {}
try {
  holder.link(Child, Base);
} catch (error) {
  console.log(error.constructor.name);
}
console.log(typeof kept, typeof holder.link, Object.keys(holder).join());
