// Objects that begin as {} and are read through globalThis by loops before the last of their names is stored.
const out = [];

function sumOfFirst() { let sum = 0; for (let i = 0; i < 4; i++) { const seen = globalThis.firstSeen; sum += seen.alpha; sum = sum * 2 + seen.beta; } return sum; }
function makeFirst(value) { const made = {}; made.alpha = value; globalThis.firstSeen = made; out.push(String(sumOfFirst())); made.beta = value + 1; out.push(String(sumOfFirst())); return made; }

function sumOfSecond() { let sum = 0; for (let i = 0; i < 4; i++) { const seen = globalThis.secondSeen; sum = sum * 2 + seen.gamma; } return sum; }
function makeSecond(value) { const made = {}; made.delta = value; globalThis.secondSeen = made; out.push(String(sumOfSecond())); made.gamma = value + 0.5; made.epsilon = value + 2; out.push(String(sumOfSecond())); return made; }

function textOfThird() { let text = ""; for (let i = 0; i < 2; i++) { const seen = globalThis.thirdSeen; text += seen.name + seen.zeta; } return text; }
function makeThird(value) { const made = {}; made.name = "n" + value; globalThis.thirdSeen = made; out.push(textOfThird()); made.zeta = "z" + value; out.push(textOfThird()); return made; }

function linesOfFourth() { let lines = 0; for (let i = 0; i < 4; i++) { const seen = globalThis.fourthSeen; lines += seen.eta | 0; lines += seen.token ? seen.token.line : 100; } return lines; }
function makeFourth(value) { const made = {}; made.eta = value; globalThis.fourthSeen = made; out.push(String(linesOfFourth())); made.token = { line: value * 3 }; out.push(String(linesOfFourth())); return made; }

let sum = 0;
for (let i = 0; i < 4; i++) sum += makeFirst(i).beta;
for (let i = 0; i < 4; i++) sum += makeSecond(i).gamma;
for (let i = 0; i < 4; i++) sum += makeThird(i).zeta.length;
for (let i = 0; i < 4; i++) sum += makeFourth(i).token.line;
console.log(out.join(), sum);
