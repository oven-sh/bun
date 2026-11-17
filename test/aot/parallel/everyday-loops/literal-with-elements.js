// A list that begins with elements and is pushed to in two loops
function grow(first, second) {
  const list = [first, second, "start"];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) list.push(list[i] + k);
    list.push(list.length);
    list[0] = i;
  }
  return list.join();
}
console.log(grow(1, 2));
console.log(grow("a", 1.5));
console.log(grow(null, undefined), grow(true, -0));
