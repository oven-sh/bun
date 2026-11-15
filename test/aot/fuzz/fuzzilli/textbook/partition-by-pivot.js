function parted(list, pivot) {
  const small = [];
  const large = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] < pivot) small.push(list[i]);
    else large.push(list[i]);
  }
  return small.concat(large);
}
console.log(parted(JSON.parse("[9,1,8,2,7,3]"), 5).join());
