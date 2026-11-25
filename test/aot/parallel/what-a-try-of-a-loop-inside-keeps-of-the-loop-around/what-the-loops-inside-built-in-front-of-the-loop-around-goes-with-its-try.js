// Each loop in the row builds a product of its own in front of the loop around, more of them than are found without a table; the last loop undoes the try of the loop around.
const unseen = x => [x][JSON.parse("0")];
function hoists(m, last) {
  let sum = 0, x0 = 0, x1 = 0, x2 = 0, x3 = 0, x4 = 0, x5 = 0, x6 = 0, x7 = 0, x8 = 0, x9 = 0, x10 = 0, x11 = 0, x12 = 0, x13 = 0, x14 = 0, x15 = 0, x16 = 0, x17 = 0, x18 = 0, x19 = 0, x20 = 0, x21 = 0, x22 = 0, x23 = 0, x24 = 0, x25 = 0, x26 = 0, x27 = 0, x28 = 0, x29 = 0, x30 = 0, x31 = 0, x32 = 0, x33 = 0, x34 = 0, x35 = 0, x36 = 0, x37 = 0, x38 = 0, x39 = 0, x40 = 0, x41 = 0, x42 = 0, x43 = 0, x44 = 0, x45 = 0, x46 = 0, x47 = 0;
  for (let r = 0; r < m; r++) {
    for (let i = 0; i < m; i++) x0 += i * (m * 0.5) + sum;
    for (let i = 0; i < m; i++) x1 += i * (m * 1.5);
    for (let i = 0; i < m; i++) x2 += i * (m * 2.5);
    for (let i = 0; i < m; i++) x3 += i * (m * 3.5);
    for (let i = 0; i < m; i++) x4 += i * (m * 4.5);
    for (let i = 0; i < m; i++) x5 += i * (m * 5.5);
    for (let i = 0; i < m; i++) x6 += i * (m * 6.5);
    for (let i = 0; i < m; i++) x7 += i * (m * 7.5);
    for (let i = 0; i < m; i++) x8 += i * (m * 8.5);
    for (let i = 0; i < m; i++) x9 += i * (m * 9.5);
    for (let i = 0; i < m; i++) x10 += i * (m * 10.5);
    for (let i = 0; i < m; i++) x11 += i * (m * 11.5);
    for (let i = 0; i < m; i++) x12 += i * (m * 12.5);
    for (let i = 0; i < m; i++) x13 += i * (m * 13.5);
    for (let i = 0; i < m; i++) x14 += i * (m * 14.5);
    for (let i = 0; i < m; i++) x15 += i * (m * 15.5);
    for (let i = 0; i < m; i++) x16 += i * (m * 16.5);
    for (let i = 0; i < m; i++) x17 += i * (m * 17.5);
    for (let i = 0; i < m; i++) x18 += i * (m * 18.5);
    for (let i = 0; i < m; i++) x19 += i * (m * 19.5);
    for (let i = 0; i < m; i++) x20 += i * (m * 20.5);
    for (let i = 0; i < m; i++) x21 += i * (m * 21.5);
    for (let i = 0; i < m; i++) x22 += i * (m * 22.5);
    for (let i = 0; i < m; i++) x23 += i * (m * 23.5);
    for (let i = 0; i < m; i++) x24 += i * (m * 24.5);
    for (let i = 0; i < m; i++) x25 += i * (m * 25.5);
    for (let i = 0; i < m; i++) x26 += i * (m * 26.5);
    for (let i = 0; i < m; i++) x27 += i * (m * 27.5);
    for (let i = 0; i < m; i++) x28 += i * (m * 28.5);
    for (let i = 0; i < m; i++) x29 += i * (m * 29.5);
    for (let i = 0; i < m; i++) x30 += i * (m * 30.5);
    for (let i = 0; i < m; i++) x31 += i * (m * 31.5);
    for (let i = 0; i < m; i++) x32 += i * (m * 32.5);
    for (let i = 0; i < m; i++) x33 += i * (m * 33.5);
    for (let i = 0; i < m; i++) x34 += i * (m * 34.5);
    for (let i = 0; i < m; i++) x35 += i * (m * 35.5);
    for (let i = 0; i < m; i++) x36 += i * (m * 36.5);
    for (let i = 0; i < m; i++) x37 += i * (m * 37.5);
    for (let i = 0; i < m; i++) x38 += i * (m * 38.5);
    for (let i = 0; i < m; i++) x39 += i * (m * 39.5);
    for (let i = 0; i < m; i++) x40 += i * (m * 40.5);
    for (let i = 0; i < m; i++) x41 += i * (m * 41.5);
    for (let i = 0; i < m; i++) x42 += i * (m * 42.5);
    for (let i = 0; i < m; i++) x43 += i * (m * 43.5);
    for (let i = 0; i < m; i++) x44 += i * (m * 44.5);
    for (let i = 0; i < m; i++) x45 += i * (m * 45.5);
    for (let i = 0; i < m; i++) x46 += i * (m * 46.5);
    for (let i = 0; i < m; i++) { x47 += i * (m * 47.5); if (r === 1 && i === 0) sum = last; }
  }
  return typeof sum + ":" + sum + "|" + typeof x0 + ":" + x0 + "|" + (0 + x1 + x2 + x3 + x4 + x5 + x6 + x7 + x8 + x9 + x10 + x11 + x12 + x13 + x14 + x15 + x16 + x17 + x18 + x19 + x20 + x21 + x22 + x23 + x24 + x25 + x26 + x27 + x28 + x29 + x30 + x31 + x32 + x33 + x34 + x35 + x36 + x37 + x38 + x39 + x40 + x41 + x42 + x43 + x44 + x45 + x46 + x47);
}
for (const last of [7, 0.25, "s", null, undefined, true]) console.log(hoists(unseen(4), unseen(last)));
