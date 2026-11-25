function idle(seed) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const never = () => { seed++; };
  return work;
}
let r = 0;
for (let k = 0; k < 300; k++) r += idle(k);
console.log(r);
