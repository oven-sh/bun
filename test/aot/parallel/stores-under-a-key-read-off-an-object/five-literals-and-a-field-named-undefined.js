const mark = Symbol.for("made.up.mark");

function pick(i) { return i & 1 ? mark : undefined; }
function lay(holder, i) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; holder[pick(i)] = "laid"; }
function twice(n) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return n + n; }
function make(i) {
  switch (i % 5) {
  case 0: return { undefined: i, other: i + 1, a: 0 };
  case 1: return { undefined: i, other: i + 1, b: 0 };
  case 2: return { undefined: i, other: i + 1, c: 0 };
  case 3: return { undefined: i, other: i + 1, d: 0 };
  default: return { undefined: i, other: i + 1, e: 0 };
  }
}
const lines = [];
for (let i = 0; i < 120; i++) {
  
  const holder = make(i);
  lay(holder, i);
  const line = [i, twice(holder.undefined), twice(holder.other), String(holder[mark])].join(" ");
  if (i < 2 || (i >= 59 && i < 62) || i === 119) lines.push(line);
}
console.log(lines.join("\n"));
