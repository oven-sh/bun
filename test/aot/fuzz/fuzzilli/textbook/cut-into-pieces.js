function pieces(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}
console.log(JSON.stringify(pieces(JSON.parse("[1,2,3,4,5,6,7]"), 3)));
