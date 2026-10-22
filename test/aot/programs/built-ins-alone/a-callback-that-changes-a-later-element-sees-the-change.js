const list = [1, 2];
const kinds = list.map((value, index) => {
  if (index === 0) list[1] = "text";
  return typeof value;
});
console.log(kinds.join());
