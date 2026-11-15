const N = Number(process.argv[2]) || 1000;
function pick(i) {
  return i ? 3 : 5;
}
function takes(job, weight) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return job() + weight + work;
}
function borrows(f, i) {
  let work = 0;
  for (let j = 0; j < 2; j++) work = (work + j) | 0;
  const got = takes(() => f(1), pick(i));
  return got + work;
}
function filledByTheStub(i) {
  let work = 0;
  for (let j = 0; j < 2; j++) work = (work + j) | 0;
  const got = borrows((x) => x + i, i);
  return got + work;
}
function twoLoansOfOneSlot(i) {
  let work = 0;
  for (let j = 0; j < 2; j++) work = (work + j) | 0;
  const first = borrows((x) => x + i, i);
  const second = borrows((x) => x - i, i);
  return first * 3 + second + work;
}
function filledInLine(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const t = i * 3;
    sum = (sum + borrows((x) => x + t, i)) | 0;
  }
  return sum;
}
function sixCaptures(i, a, b, c, d, e) {
  let work = 0;
  for (let j = 0; j < 2; j++) work = (work + j) | 0;
  const got = borrows((x) => x + i + a * 2 + b * 3 + c * 5 + d * 7 + e * 11, i);
  return got + work;
}
function nineCaptures(i, a, b, c, d, e, g, h, k) {
  let work = 0;
  for (let j = 0; j < 2; j++) work = (work + j) | 0;
  const got = borrows((x) => x + i + a * 2 + b * 3 + c * 5 + d * 7 + e * 11 + g * 13 + h * 17 + k * 19, i);
  return got + work;
}
function eachAlone(count) {
  let stub = 0;
  for (let i = 0; i < count; i++) stub = (stub + filledByTheStub(i)) | 0;
  let two = 0;
  for (let i = 0; i < count; i++) two = (two + twoLoansOfOneSlot(i)) | 0;
  let six = 0;
  for (let i = 0; i < count; i++) six = (six + sixCaptures(i, i + 1, i + 2, i + 3, i + 4, i + 5)) | 0;
  let nine = 0;
  for (let i = 0; i < count; i++) nine = (nine + nineCaptures(i, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6, i + 7, i + 8)) | 0;
  return stub + " " + two + " " + filledInLine(count) + " " + six + " " + nine;
}
function allInTurn(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum = (sum * 31 + filledByTheStub(i)) | 0;
    sum = (sum * 31 + nineCaptures(i, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6, i + 7, i + 8)) | 0;
    sum = (sum * 31 + twoLoansOfOneSlot(i)) | 0;
    sum = (sum * 31 + sixCaptures(i, i + 1, i + 2, i + 3, i + 4, i + 5)) | 0;
  }
  return sum;
}
console.log(eachAlone(N));
console.log(allInTurn(N));
