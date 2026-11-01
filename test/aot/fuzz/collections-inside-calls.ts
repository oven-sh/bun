// What a function holds in its frame while it runs is seen by a collection only if one happens inside the call. `withCollectionsInsideCalls` makes the body of each function, method, accessor
// and callback of a program begin with a call that collects: the first thirty times, and now and then during the next forty thousand. The program prints what it printed before.
const bodies = [
  /^([ \t]*(?:export )?(?:default )?(?:async )?function\*? ?[\w$]*\([^\n]*\)(?:: [^\n{]+)? \{)\n(?![ \t]*["'])/gm,
  /^([ \t]*(?:static )?(?:get|set) [\w$#]+\([^\n]*\)(?:: [^\n{]+)? \{)\n/gm,
  /^([ \t]*(?:static )?(?:async )?\*?(?!if\b|for\b|while\b|switch\b|catch\b|with\b|function\b|return\b)[\w$#]+\([^\n]*\)(?:: [^\n{]+)? \{)\n(?![ \t]*["'])/gm,
  /^([^\n`]*=> \{)\n(?![ \t]*["'])/gm,
];

// What such a program prints hangs on when a collection runs, or its text is also read at run time.
const isLeftAlone =
  /\bWeakRef\b|\bFinalizationRegistry\b|\bheapStats\b|\bmemoryUsage\b|\beval\b|\bFunction\(|\.toString\(\)|\bcollectInside\b|`[^`\n]*\n/;

export function withCollectionsInsideCalls(text: string, loader: "ts" | "js"): string {
  if (isLeftAlone.test(text)) return text;
  let changed = text;
  // A line that ends where the body of a class begins is left alone.
  for (const body of bodies)
    changed = changed.replace(body, (whole, head) => (/\bclass\b/.test(head) ? whole : `${head}\ncollectInside();\n`));
  if (changed === text) return text;
  changed += `\nvar collectionsInside = 0;\nfunction collectInside() {\n  collectionsInside = (collectionsInside || 0) + 1;\n  if (collectionsInside <= 30 || (collectionsInside % 1009 === 0 && collectionsInside < 40000)) Bun.gc(true);\n}\n`;
  try {
    new Bun.Transpiler({ loader }).transformSync(changed);
  } catch {
    return text;
  }
  return changed;
}
