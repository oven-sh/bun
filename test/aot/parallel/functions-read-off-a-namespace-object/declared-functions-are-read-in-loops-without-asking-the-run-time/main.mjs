// COUNTER: operationAOTGetById <= 60
// COUNTER: operationAOTGetGeneric <= 60
const library = await import("./library.mjs");
const onlyFunctions = await import("./only-functions.mjs");
const rounds = 20000;
function count(holder) {
  let words = 0;
  for (let i = 0; i < rounds; i++) if (holder.isWordCharacter(32 + (i & 63))) words++;
  return words;
}
function countSame(holder) {
  const first = holder.isWordCharacter;
  let same = 0;
  for (let i = 0; i < rounds; i++) if (holder.isWordCharacter === first) same++;
  return same;
}
function lastSaid(holder) {
  let last;
  for (let i = 0; i < rounds; i++) last = holder.swapped();
  return last;
}
function construct(holder) {
  let steps = 0;
  for (let i = 0; i < rounds; i++) steps += new holder.Counter().step();
  return steps;
}
function iterate(holder) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) for (const n of holder.upTo(3)) sum += n;
  return sum;
}
async function wait(holder) {
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += await holder.later(i);
  return sum;
}
function call(holder) {
  let last = 0;
  for (let i = 0; i < rounds; i++) last = holder.counted();
  return last;
}
function countArrows(holder) {
  let found = 0;
  for (let i = 0; i < rounds; i++) if (holder.arrow(64 + (i & 63))) found++;
  return found;
}
function countDigits(holder) {
  let digits = 0;
  for (let i = 0; i < rounds; i++) if (holder.isDigit(32 + (i & 63)) || holder.isSpace(32 + (i & 63))) digits++;
  return digits;
}
console.log(count(library), countSame(library), countArrows(library), countDigits(onlyFunctions));
console.log(lastSaid(library));
library.swap();
console.log(lastSaid(library));
console.log(construct(library), iterate(library), await wait(library));
console.log(call(library), library.counted.calls);
console.log(count({ isWordCharacter: code => code === 32 }), count(library));
console.log(Object.keys(library).join(" "), typeof library.isWordCharacter, library.isWordCharacter.name, library.isWordCharacter.length);
