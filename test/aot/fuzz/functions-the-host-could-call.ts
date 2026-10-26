// A function that only the program calls is known together with all its callers. `withFunctionsTheHostCouldCall` stores every function and class that a file declares at its top on the global
// object, where code that nobody sees at build time could find and call it, and beside them a function that asks of a value whether it is an instance of each. Nobody calls any of them: the
// program prints what it printed before.
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
  const kept = Array.from(names, name => `Reflect.set(globalThis, "keptForTheHost ${name}", ${name});`);
  const asked = Array.from(names, name => `value instanceof ${loader === "ts" ? `(${name} as any)` : name}`);
  return `${text}\n${kept.join("\n")}\nReflect.set(globalThis, "keptForTheHost asks", (value${loader === "ts" ? ": unknown" : ""}) => [${asked.join(", ")}]);\n`;
}
