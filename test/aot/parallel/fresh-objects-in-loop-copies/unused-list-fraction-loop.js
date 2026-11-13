// Under: --aot-check=Validate: the copies of a loop that begin late know the objects made in front
function fill(values) {
  const spare = [];
  const list = [];
  for (const value of values)
    list.push(value);
  const doubled = [];
  let last = -1;
  const n = list.length + 0.5;
  for (let i = n - 1; i >= 0; i--) {
    if (list[i] === last)
      last = list[i];
    doubled[i * 2] = list[i] + 1;
  }
  return spare.length + "/" + last + "/" + doubled.length;
}
console.log(fill(JSON.parse("[1,2,3]")), fill([]));
