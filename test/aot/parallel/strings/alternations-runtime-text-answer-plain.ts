// Thousands of patterns with alternations, put together at run time out of a seeded generator, so that none of them is known to the build: lists of words that share first letters and lists that do not,
// nested groups, captures, optional and repeated groups, classes, anchors, lookaheads, back references, with and without the flag i, against subjects of narrow and of wide characters.
// Which alternative wins, where the match lies and what every group holds is printed as a sum for every two hundred patterns. The output is that of plain Bun.
// No alternative is written empty: on a repeated group with an empty alternative, as in /(|[^b]??|)+/ inside a longer pattern, plain Bun misses matches that ECMAScript has and that the compiled program finds.
// Alone: it measures time, memory or what is collected, and that depends on what the compiler knows about the whole executable
let seed = 12345 + (typeof process === "object" ? process.argv.length - process.argv.length : 0);
function random(limit: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % limit;
}
function pick(list: string[]): string {
  return list[random(list.length)];
}
const letters = ["a", "b", "c", "A", "B", "x", "é", "Ж", "1", "_", " "];
const classes = ["[ab]", "[^a]", "[a-c]", "\\w", "\\d", "\\s", ".", "[\\u200b\\u0416]", "[^\\u0416b]", "[A-Cx]"];
const quantifiers = ["", "", "", "", "?", "*", "+", "??", "*?", "+?", "{2}", "{1,2}", "{0,2}?"];
function word(): string {
  let text = "";
  for (let i = 1 + random(4); i > 0; i--) text += pick(letters);
  return text;
}
function spacedWord(): string {
  return [...word()].join("[\\u200b_]*");
}
function atom(depth: number, groups: { count: number }): string {
  switch (random(depth > 0 ? 12 : 7)) {
    case 0: case 1: case 2: return pick(letters);
    case 3: case 4: return pick(classes);
    case 5: return word();
    case 6: return pick(["^", "$", "\\b", "\\B"]);
    case 7: return "(?:" + disjunction(depth - 1, groups) + ")";
    case 8: groups.count++; return "(" + disjunction(depth - 1, groups) + ")";
    case 9: return pick(["(?=", "(?!"]) + disjunction(depth - 1, groups) + ")";
    case 10: return groups.count ? "\\" + (1 + random(groups.count)) : pick(letters);
    default: return "(?:" + disjunction(depth - 1, groups) + ")";
  }
}
function alternative(depth: number, groups: { count: number }): string {
  let text = "";
  for (let i = 1 + random(3); i > 0; i--) {
    const piece = atom(depth, groups);
    const isAssertion = piece === "^" || piece === "$" || piece === "\\b" || piece === "\\B" || piece.startsWith("(?=") || piece.startsWith("(?!");
    text += piece.length > 1 && !piece.startsWith("(") && !piece.startsWith("[") && !piece.startsWith("\\") ? piece : piece + (isAssertion ? "" : pick(quantifiers));
  }
  return text;
}
function disjunction(depth: number, groups: { count: number }): string {
  const kind = random(6);
  const count = kind === 0 ? 1 : kind === 1 ? 2 : kind === 2 ? 3 + random(3) : kind === 3 ? 8 + random(30) : 1 + random(4);
  const list: string[] = [];
  for (let i = 0; i < count; i++) list.push(kind === 3 ? (random(2) ? word() : spacedWord()) : alternative(depth, groups));
  return list.join("|");
}
function subject(): string {
  let text = "";
  for (let i = random(24); i > 0; i--) text += random(8) ? pick(letters) : pick(["​", "ab", "abc", "\n", "xA"]);
  return text;
}
let sum = 0;
let made = 0;
const lines: string[] = [];
for (let round = 0; round < 6000; round++) {
  const source = disjunction(2, { count: 0 });
  const flags = pick(["", "i", "g", "gi", "m", "y", "s"]);
  let pattern: RegExp;
  try {
    pattern = new RegExp(source, flags);
  } catch {
    sum = (sum * 31 + 7) | 0;
    continue;
  }
  made++;
  for (let i = 0; i < 4; i++) {
    const text = subject();
    pattern.lastIndex = random(3);
    const match = pattern.exec(text);
    if (!match) {
      sum = (sum * 31 + 1) | 0;
      continue;
    }
    sum = (sum * 31 + match.index + 2) | 0;
    for (const group of match) sum = (sum * 31 + (group === undefined ? 3 : group.length * 5 + (group.charCodeAt(0) | 0))) | 0;
    sum = (sum * 31 + text.replace(pattern, "<$&>").length) | 0;
  }
  if (round % 200 === 199) lines.push(round + 1 + " " + sum);
}
console.log(made);
console.log(lines.join("\n"));
// As plain Bun prints it: the run that shows so takes up to half a minute.
/* Output:
6000
200 1907123158
400 1474740875
600 1280953516
800 -1056581556
1000 1273386479
1200 -1549316937
1400 1320247666
1600 230389790
1800 -1855634999
2000 352972960
2200 -597551324
2400 -804446267
2600 -1460538629
2800 1984752225
3000 -834638843
3200 1066121564
3400 1443178021
3600 -752038229
3800 -995078124
4000 -2079464113
4200 -2011620745
4400 1182063887
4600 630957731
4800 -1946904900
5000 -1664548734
5200 86753985
5400 1137064658
5600 595452934
5800 1326206513
6000 -686270842
*/
