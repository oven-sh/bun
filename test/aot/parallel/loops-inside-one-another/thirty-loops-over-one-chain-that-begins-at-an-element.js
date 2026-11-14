// Thirty loops inside one another; the innermost reckons with an element out of unseen data in a turn of more than a hundred operations.
const held = JSON.parse("[[1,2],[3,4]]");
function large(rows) {
  let s = 0;
for (let i0 = 0; i0 < 2; i0++) {
for (let i1 = 0; i1 < 2; i1++) {
for (let i2 = 0; i2 < 1; i2++) {
for (let i3 = 0; i3 < 1; i3++) {
for (let i4 = 0; i4 < 1; i4++) {
for (let i5 = 0; i5 < 1; i5++) {
for (let i6 = 0; i6 < 1; i6++) {
for (let i7 = 0; i7 < 1; i7++) {
for (let i8 = 0; i8 < 1; i8++) {
for (let i9 = 0; i9 < 1; i9++) {
for (let i10 = 0; i10 < 1; i10++) {
for (let i11 = 0; i11 < 1; i11++) {
for (let i12 = 0; i12 < 1; i12++) {
for (let i13 = 0; i13 < 1; i13++) {
for (let i14 = 0; i14 < 1; i14++) {
for (let i15 = 0; i15 < 1; i15++) {
for (let i16 = 0; i16 < 1; i16++) {
for (let i17 = 0; i17 < 1; i17++) {
for (let i18 = 0; i18 < 1; i18++) {
for (let i19 = 0; i19 < 1; i19++) {
for (let i20 = 0; i20 < 1; i20++) {
for (let i21 = 0; i21 < 1; i21++) {
for (let i22 = 0; i22 < 1; i22++) {
for (let i23 = 0; i23 < 1; i23++) {
for (let i24 = 0; i24 < 1; i24++) {
for (let i25 = 0; i25 < 1; i25++) {
for (let i26 = 0; i26 < 1; i26++) {
for (let i27 = 0; i27 < 1; i27++) {
for (let i28 = 0; i28 < 1; i28++) {
for (let i29 = 0; i29 < 1; i29++) {
let k = rows[0][0];
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
k = k * 2 - 1;
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
s += rows[k][0];
s += rows[k][1];
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
  return s;
}
let sum = 0;
for (let t = 0; t < Number(process.argv[2] ?? 3); t++) sum += large(held);
console.log(sum);
