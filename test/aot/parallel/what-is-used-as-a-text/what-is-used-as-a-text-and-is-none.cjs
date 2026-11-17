function sumOfUnits(text) {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
  return sum;
}
function say(make) {
  try {
    return String(sumOfUnits(make()));
  } catch (error) {
    return error.constructor.name;
  }
}
class Odd {
  constructor(length) {
    this.length = length;
  }
  charCodeAt(place) {
    return place * 2;
  }
}
let looks = 0;
const strangers = [
  () => JSON.parse('"plain"'),
  () => ({ length: 3, charCodeAt: place => place + 1 }),
  () => new Odd(4),
  () => new String("boxed"),
  () => null,
  () => undefined,
  () => 12,
  () => [1, 2, 3],
  () => new Proxy({}, { get: (target, key) => (looks++, key === "length" ? 2 : () => 7) }),
  () => Object.assign(Object.create(null), { length: 1, ["char" + "CodeAt"]: () => 40 }),
  () => "Ж😀",
  () => "left".concat(JSON.parse('"right"')),
];
const said = [];
for (let round = 0; round < 3; round++) for (const make of strangers) said.push(say(make));
console.log(said.join(" "), looks);
