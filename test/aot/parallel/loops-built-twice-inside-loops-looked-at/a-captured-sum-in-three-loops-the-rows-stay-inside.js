const show = items => {
  let text = "";
  for (let i = 0; i < items.length; i++) text += items[i] + " ";
  return text;
};
function main(list, out, count) {
  let sum = 0;
  const rows = [];
  for (let i = 0; i < count; i++) {
    const note = () => {
      out.push(sum);
    };
    if (out.length < 40) note();
    list[i] = out[i];
  }
  for (let i = 0; i < count; i++) {
    list[1] *= undefined;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let q = 0; q < row.length; q++) sum += row[q];
    }
  }
  return show(list);
}
console.log(main(new Array(3), [0.5], 4));
console.log(main(JSON.parse("[7]"), JSON.parse("[7]"), 1));
