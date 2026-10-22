function mark(holder) {
  holder[Symbol()] = 1;
}
let count = 0;
for (let i = 0; i < 3; i++) {
  const holder = {};
  mark(holder);
  count += Object.getOwnPropertySymbols(holder).length;
}
console.log(count);
