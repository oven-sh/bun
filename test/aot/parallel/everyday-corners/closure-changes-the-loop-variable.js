// Closure changes the loop variable: compiled answers as plain.
const out = [];
for (let i = 0; i < 6; i++) {
  const bump = () => {
    i += 2;
  };
  if (i === 1) bump();
  out.push(i);
}
console.log(out.join());
