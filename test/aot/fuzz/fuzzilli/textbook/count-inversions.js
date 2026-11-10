function inversions(list) {
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    const one = list[i];
    for (let j = i + 1; j < list.length; j++) {
      if (one > list[j]) count++;
    }
  }
  return count;
}
console.log(inversions(JSON.parse("[3,1,4,2]")), inversions(JSON.parse("[1,2,3]")));
