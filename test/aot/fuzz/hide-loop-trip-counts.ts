// A short loop with a constant trip count may be fully unrolled. `hideLoopTripCounts` adds a run-time-only term to the
// bound of each such loop: `i < 4` becomes `i < 4 + extraTurns()`, `of [a, b]` becomes `of [a, b].slice(extraTurns())`.
// The output stays the same.
export function hideLoopTripCounts(text: string): string {
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
