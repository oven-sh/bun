// Loops that are run twice: over fewer turns than compiled code lets pass between two polls, and over more. A turn should cost the same in both runs.
// Several functions hold the same loop, so that whatever shares code between functions finds it. ../equivalent-forms.test.ts holds each pair together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
const many = 1 << 21;

interface Settings {
  retries: number;
  delay: number;
  limit: number;
}
const reds: Settings[] = [];
const greens: Settings[] = [];
const blues: Settings[] = [];
const greys: Settings[] = [];
for (let k = 0; k < 8; k++) {
  reds.push({ retries: 1, delay: k & 1 ? 2 : 5, limit: k & 1 ? 6 : 3 });
  greens.push({ retries: 2, delay: k & 1 ? 3 : 6, limit: k & 1 ? 7 : 4 });
  blues.push({ retries: 3, delay: k & 1 ? 4 : 7, limit: k & 1 ? 8 : 5 });
  greys.push({ retries: 4, delay: k & 1 ? 5 : 8, limit: k & 1 ? 9 : 6 });
}

function sumOfReds(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const object = reds[i & 7];
    sum += object.retries + object.delay + object.limit;
  }
  return sum;
}

function sumOfGreens(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const object = greens[i & 7];
    sum += object.retries + object.delay + object.limit;
  }
  return sum;
}

function sumOfBlues(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const object = blues[i & 7];
    sum += object.retries + object.delay + object.limit;
  }
  return sum;
}

function sumOfGreys(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const object = greys[i & 7];
    sum += object.retries + object.delay + object.limit;
  }
  return sum;
}

const loops: Record<string, (n: number) => number> = {
  "members of a first list added up in few turns": n => sumOfReds(n),
  "members of a first list added up in many turns": n => sumOfReds(n + many),
  "members of a second list added up in few turns": n => sumOfGreens(n),
  "members of a second list added up in many turns": n => sumOfGreens(n + many),
  "members of a third list added up in few turns": n => sumOfBlues(n),
  "members of a third list added up in many turns": n => sumOfBlues(n + many),
  "members of a fourth list added up in few turns": n => sumOfGreys(n),
  "members of a fourth list added up in many turns": n => sumOfGreys(n + many),
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));

export {};
