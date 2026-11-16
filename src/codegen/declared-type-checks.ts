// The types that native code declares for a value which it makes itself.

export type DeclaredAlternative =
  | "string"
  | "number"
  | "int32"
  | "bigint"
  | "boolean"
  | "undefined"
  | "null"
  | "object" /* any object, functions too */
  | "Promise"
  | "this" /* the receiver itself */
  | { instance: string /* a class */ };

/** What `b.any.returning` takes as a word. */
export function parseDeclaredAlternative(word: string): DeclaredAlternative {
  switch (word) {
    case "string":
    case "number":
    case "int32":
    case "bigint":
    case "boolean":
    case "undefined":
    case "null":
    case "object":
    case "Promise":
    case "this":
      return word;
  }
  if (!/^[A-Z][A-Za-z0-9]*(?:(?<=\d)_\d+)*$/.test(word)) throw new Error(`'${word}' is not a declared type`);
  return { instance: word };
}

/** A union of those words, written with `|`. */
export function parseDeclaredType(text: string): DeclaredAlternative[] {
  const words = text.split("|").map(word => word.trim());
  if (new Set(words).size !== words.length) throw new Error(`'${text}' is not a declared type`);
  try {
    return words.map(parseDeclaredAlternative);
  } catch {
    throw new Error(`'${text}' is not a declared type`);
  }
}

/** As TypeScript spells it. */
export function typeScriptOf(words: readonly string[]): string {
  const spell = (word: string) => {
    const alternative = parseDeclaredAlternative(word);
    if (typeof alternative === "object") return alternative.instance === "Array" ? "unknown[]" : alternative.instance;
    return alternative === "int32" ? "number" : alternative === "Promise" ? "Promise<unknown>" : alternative;
  };
  return words.map(spell).join(" | ");
}
