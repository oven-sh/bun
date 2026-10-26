// A function that only the program calls is known together with all its callers. `withFunctionsTheHostCouldCall` hands every function and class that a file declares at its top to the host: in
// turns it stores one on the global object, where code that nobody sees at build time could find and call it, and makes the next a listener of `process` for an event that never comes. Beside
// them it stores a function that asks of a value whether it is an instance of each. Nobody calls any of them: the program prints what it printed before. The lines are written so that the
// build still knows every module that the program can load (the-world-is-open.ts).
const declaration = /^[ \t]*(?:export )?(?:default )?(?:async )?(?:function\*?|class) ([\w$]+)/gm;

export function withFunctionsTheHostCouldCall(text: string, loader: "ts" | "js"): string {
  if (/\bkeptForTheHost\b|`[^`\n]*\n/.test(text)) return text;
  let printed: string;
  try {
    printed = new Bun.Transpiler({ loader }).transformSync(text);
  } catch {
    return text;
  }
  // What is printed again has its nested declarations indented, and its texts of several lines laid out as lines.
  const written = new Set(Array.from(text.matchAll(declaration), match => match[1]));
  const names = new Set(
    Array.from(printed.matchAll(declaration), match => (match[0].startsWith(" ") ? "" : match[1])).filter(name =>
      written.has(name),
    ),
  );
  if (names.size === 0) return text;
  const untyped = (name: string) => (loader === "ts" ? `(${name} as any)` : name);
  const kept = Array.from(names, (name, index) =>
    index % 2
      ? `${untyped("process")}.on("keptForTheHost ${name}", ${name});`
      : `${untyped("globalThis")}["keptForTheHost ${name}"] = ${name};`,
  );
  const asked = Array.from(names, name => `value instanceof ${untyped(name)}`);
  // The semicolon in front: a line may begin with a parenthesis.
  return `${text}\n;${kept.join("\n")}\n${untyped("globalThis")}["keptForTheHost asks"] = (value${loader === "ts" ? ": unknown" : ""}) => [${asked.join(", ")}];\n`;
}
