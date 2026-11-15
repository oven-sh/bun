// Assignments to length inside two loops
function trim(lists, keep) {
  const sizes = [];
  for (const list of lists) {
    while (list.length > keep) {
      const last = list[list.length - 1];
      list.length = last === null || last === undefined ? list.length - 1 : list.length - 2 < keep ? keep : list.length - 2;
      sizes.push(list.length);
    }
    list[list.length] = "end";
    sizes.push(list.length);
  }
  return sizes.join() + " " + lists.map(String).join(" ; ");
}
console.log(trim([[1, 2, 3, 4, 5], [null, null, null], []], 1));
console.log(trim([["a", "b", undefined, "c"]], 2));
console.log(trim([[1.5, , 2.5, , 3.5]], 0));
