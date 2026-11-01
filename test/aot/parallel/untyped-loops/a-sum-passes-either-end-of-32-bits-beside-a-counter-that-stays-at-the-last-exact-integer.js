const STEP = 3;
function upByAConstantOfTheModule(v, b) {
  let k = 9007199254740983,
    s = 2147483600;
  let t = 0,
    m = 0,
    idx = -1;
  const bump = () => {
    k += 1;
  };
  let i = 0;
  if (v.length > 0)
    do {
      i++;
      idx++;
      bump();
      s += STEP;
      for (let q = 0; q < 3; q++) {
        t += k;
        m++;
      }
      if (idx === b) break;
    } while (i < v.length);
  return [k, s, t, m].join();
}
function downByAWrittenNumber(v, b) {
  let k = 9007199254740983,
    s = -2147483601;
  let t = 0,
    m = 0,
    idx = -1;
  const bump = () => {
    k += 1;
  };
  let i = 0;
  if (v.length > 0)
    do {
      i++;
      idx++;
      bump();
      s -= 3;
      for (let q = 0; q < 3; q++) {
        t += k;
        m++;
      }
      if (idx === b) break;
    } while (i < v.length);
  return [k, s, t, m].join();
}
const list = n => Array.from({ length: n }, (_, i) => i % 97);
for (const n of [0, 1, 2, 7, 8, 9, 15, 16, 17, 23, 24, 25, 31, 32, 33, 64, 65, 1000])
  for (const b of [-1, 0, 3, 7, 8, 9, 11, 12, 15, 16, 20, 500])
    console.log(n, b, upByAConstantOfTheModule(list(n), b), downByAWrittenNumber(list(n), b));
