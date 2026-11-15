// STATISTIC: InvariantArrayLoopsVersioned >= 1
const rounds = Number(process.argv[2] ?? 3);
function grid(height, width, step) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) row.push((x * 7 + y * 5) % 11 + step);
    rows.push(row);
  }
  return rows;
}
function sum(rows, height, width) {
  let s = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k1 = y & y;
      const k2 = k1 | y;
      const k3 = k2 & k1;
      const k4 = k3 | k2;
      const k5 = k4 & k3;
      const k6 = k5 | k4;
      const k7 = k6 & k5;
      const k8 = k7 | k6;
      const k9 = k8 & k7;
      const k10 = k9 | k8;
      const k11 = k10 & k9;
      const k12 = k11 | k10;
      const k13 = k12 & k11;
      const k14 = k13 | k12;
      const k15 = k14 & k13;
      const k16 = k15 | k14;
      const k17 = k16 & k15;
      const k18 = k17 | k16;
      const k19 = k18 & k17;
      const k20 = k19 | k18;
      const k21 = k20 & k19;
      const k22 = k21 | k20;
      const k23 = k22 & k21;
      const k24 = k23 | k22;
      const k25 = k24 & k23;
      const k26 = k25 | k24;
      const k27 = k26 & k25;
      const k28 = k27 | k26;
      const k29 = k28 & k27;
      const k30 = k29 | k28;
      const k31 = k30 & k29;
      const k32 = k31 | k30;
      const k33 = k32 & k31;
      const k34 = k33 | k32;
      const k35 = k34 & k33;
      const k36 = k35 | k34;
      const k37 = k36 & k35;
      const k38 = k37 | k36;
      const k39 = k38 & k37;
      const k40 = k39 | k38;
      const k41 = k40 & k39;
      const k42 = k41 | k40;
      const k43 = k42 & k41;
      const k44 = k43 | k42;
      const k45 = k44 & k43;
      const k46 = k45 | k44;
      const k47 = k46 & k45;
      const k48 = k47 | k46;
      s = s + rows[k48][x];
    }
  }
  return s;
}
const numbers = grid(6, 12, 0.5);
const said = [];
for (let round = 0; round < rounds; round++) {
  try { said.push(String(sum(numbers, 6, 12))); } catch (error) { said.push(error.constructor.name); }
}
console.log(said.join(" "));
