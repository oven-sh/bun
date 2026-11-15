function gathered(rows) {
  const groups = {};
  for (let i = 0; i < rows.length; i++) {
    const key = rows[i].kind;
    if (!groups[key]) groups[key] = [];
    groups[key].push(rows[i].name);
  }
  return groups;
}
console.log(
  JSON.stringify(
    gathered(JSON.parse('[{"kind":"tree","name":"ash"},{"kind":"bird","name":"wren"},{"kind":"tree","name":"elm"}]')),
  ),
);
