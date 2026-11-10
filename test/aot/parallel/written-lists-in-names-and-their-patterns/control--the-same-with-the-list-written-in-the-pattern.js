function spin(turns, plain) {
  let a = 1, b = 2;
  for (let i = 0; i < turns; i++) {
    const steps = plain ? { step: 1 } : { step: 2 };
    const mark = (i & 1) ? 1 : 0;
    [a, b] = [b, (a + steps.step) | 0];
    b = (b + mark) | 0;
  }
  return a + ":" + b;
}
console.log(spin(300, true), spin(300, false), spin(3, true));
