function walk(first, later) {
  let held = first;
  let sum = 0;
  for (let turn = 0; turn < 12; turn++) {
    sum = (sum * 31 + held.charCodeAt(turn % held.length)) % 1000003;
    if (turn % 4 === 3) held = later[(turn >> 2) % later.length];
    else if (typeof held === "string") held = held.slice(1) + held[0];
  }
  return sum;
}
const later = [{ length: 5, charCodeAt: place => 100 + place }, JSON.parse('"again"'), new String("boxed")];
let all = 0;
for (let round = 0; round < 50; round++) all = (all + walk(JSON.parse('"begin' + round + '"'), later)) % 1000003;
console.log(all);

function* steps(text) {
  for (let i = 0; i < text.length; i++) yield text.charCodeAt(i);
}
function caught(text) {
  let sum = 0;
  try {
    for (let i = 0; i <= text.length; i++) {
      if (i === text.length) text = null;
      sum += text.charCodeAt(i);
    }
  } catch (error) {
    return sum + ":" + error.constructor.name;
  }
  return sum;
}
console.log([...steps(JSON.parse('"yield"'))].join(), [...steps({ length: 2, charCodeAt: place => -place })].join(), caught(JSON.parse('"thrown"')));
