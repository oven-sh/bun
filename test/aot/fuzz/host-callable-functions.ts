// The compiler knows all callers of a function that only the program calls. `withFunctionsTheHostCouldCall` exposes
// every top-level function and class of a file to the host, for example by storing it on the global object, where code
// unseen at build time could call it. The output stays the same.
const declaration = /^[ \t]*(?:export )?(?:default )?(?:async )?(?:function\*?|class) ([\w$]+)/gm;

export function withFunctionsTheHostCouldCall(text: string, loader: "ts" | "js"): string {
  if (/\bkeptForTheHost\b|`[^`\n]*\n/.test(text)) return text;
  let printed: string;
  try {
    printed = new Bun.Transpiler({ loader }).transformSync(text);
  } catch {
    return text;
  }
  // Reprinted code has its nested declarations indented, and its multi-line strings laid out as lines.
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
  // The leading semicolon: a line may begin with a parenthesis.
  return `${text}\n;${kept.join("\n")}\n${untyped("globalThis")}["keptForTheHost asks"] = (value${loader === "ts" ? ": unknown" : ""}) => [${asked.join(", ")}];\n`;
}
