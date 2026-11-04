const made = [];
for (let index = 0; index < 2; index += 1) {
  const step = () => "step " + index;
  made.push(step);
}
console.log(made.map(step => step()).join());
