function sorted(list) {
  for (let i = 0; i < list.length; i++) {
    let least = i;
    for (let j = i + 1; j < list.length; j++) {
      if (list[j] < list[least]) least = j;
    }
    const one = list[i];
    list[i] = list[least];
    list[least] = one;
  }
  return list;
}
console.log(sorted(JSON.parse("[64,25,12,22,11]")).join());
