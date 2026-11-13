function shares(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    let whole = 0;
    for (let j = 0; j < list.length; j++) whole += list[j];
    out.push(Math.round((list[i] * 100) / whole));
  }
  return out;
}
console.log(shares(JSON.parse("[1,3,4,2]")).join());
