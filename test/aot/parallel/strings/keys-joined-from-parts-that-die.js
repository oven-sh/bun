// A key that is joined from two parts is remembered by the parts, a string by its address. A string that has died must not answer for another one that is allocated in its place.
const letter = n => 97 + (n % 26);
// A flat string that nothing else holds.
const fresh = (round, j) => String.fromCharCode(letter(j), letter((j / 26) | 0), letter(round), letter(round * 7 + j));
const spelled = (head, round, j) => [head, fresh(round, j)].join("");

let wrong = 0;
let checked = 0;
function check(holder, expected) {
  const names = Object.keys(holder);
  checked++;
  if (names.length !== 1 || names[0] !== expected) wrong++;
}

const heads = ["on", "_", "data-"];
for (let round = 0; round < 60; round++) {
  let parts = [];
  for (let j = 0; j < 700; j++) parts.push(fresh(round, j));
  // The first join enters the pair, the later ones find it.
  for (let again = 0; again < 3; again++) {
    for (let j = 0; j < parts.length; j++) {
      const head = heads[j % 3];
      const front = {};
      front[head + parts[j]] = 1;
      check(front, spelled(head, round, j));
      const back = {};
      back[parts[j] + head] = 1;
      check(back, [fresh(round, j), head].join(""));
      const numbered = {};
      numbered[parts[j] + (j & 15)] = 1;
      check(numbered, [fresh(round, j), String(j & 15)].join(""));
    }
  }
  parts = null;
  Bun.gc(round % 3 !== 0);
}

// Parts that are no strings are compared by their bits.
const others = [0, 1, -1, 7, 2147483647, -2147483648, 0.5, -0, NaN, Infinity, true, false, null, undefined, 10n, 1e21];
for (let again = 0; again < 3; again++) {
  for (const left of others) {
    for (const right of ["", "x", "key"]) {
      const holder = {};
      holder[left + right] = 1;
      check(holder, [String(left), right].join(""));
      const mirrored = {};
      mirrored[right + left] = 1;
      check(mirrored, [right, String(left)].join(""));
    }
  }
}
console.log(checked, "keys,", wrong, "wrong");
