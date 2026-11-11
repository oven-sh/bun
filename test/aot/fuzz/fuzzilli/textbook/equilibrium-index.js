function balance(list) {
  let whole = 0;
  for (let i = 0; i < list.length; i++) whole += list[i];
  let left = 0;
  for (let i = 0; i < list.length; i++) {
    if (left === whole - left - list[i]) return i;
    left += list[i];
  }
  return -1;
}
console.log(balance(JSON.parse("[1,7,3,6,5,6]")));
