// Callbacks of forEach and map that push into lists outside, inside a loop
function collect(lists) {
  const flat = [];
  const sizes = [];
  for (let i = 0; i < lists.length; i++) {
    lists[i].forEach((value, at) => {
      flat.push(value);
      if (at === i) flat.push("*");
    });
    sizes.push(lists[i].map(value => flat.push(value)).pop());
    flat.pop();
  }
  return flat.join() + " " + sizes.join();
}
console.log(collect([[1, 2], [3], []]));
console.log(collect([["a", 1.5, null]]));
console.log(collect([[], [[], [1]], [undefined, undefined, 0]]));
