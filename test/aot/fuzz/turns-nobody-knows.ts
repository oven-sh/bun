// A short loop whose number of turns stands in the program may be compiled turn by turn, and then it is no loop any more. `withTurnsNobodyKnows`
// gives the bound of each such loop a part that only the run knows: `i < 4` becomes `i < 4 + extraTurns()`, `of [a, b]` becomes
// `of [a, b].slice(extraTurns())`. The program prints what it printed before.
export function withTurnsNobodyKnows(text: string): string {
  let isChanged = false;
  const changed = text
    .replace(
      /for \((let|var) (\w+) = (\d+); \2 (<|<=) (\d); \2(\+\+| \+= \d)\)/g,
      (_, kind, name, first, test, bound, step) => (
        (isChanged = true),
        `for (${kind} ${name} = ${first}; ${name} ${test} ${bound} + extraTurns(); ${name}${step})`
      ),
    )
    .replace(/ of (\[[^\[\]\n]{1,60}\])\)/g, (_, list) => ((isChanged = true), ` of ${list}.slice(extraTurns()))`));
  if (!isChanged || /\bextraTurns\b/.test(text)) return text;
  return `${changed}\nfunction extraTurns() {\n  return Date.now() < 99 ? 1 : 0;\n}\n`;
}
