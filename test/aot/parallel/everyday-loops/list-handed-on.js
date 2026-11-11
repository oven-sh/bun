// A list that is pushed to in a nest and handed to a function in between
function add(list, value) {
  list.push(value);
  return list.length;
}
function fill(value) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      out.push(k);
      if (add(out, value) > 6) out.push("over");
    }
    out.push(i);
  }
  return out.join();
}
console.log(fill(9));
console.log(fill("v"));
console.log(fill(1.25), fill(undefined));
