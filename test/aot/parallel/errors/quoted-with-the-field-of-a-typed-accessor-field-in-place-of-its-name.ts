// A typed `accessor #x` field holds null, and a method reads a member of it: the message quotes the name of the field that holds the value, which Bun's transpiler prints in place of `#x`.
class Cache {
  accessor #store: Map<string, number> | null = null;
  static accessor #shared: { hits: number } | null = null;
  size(): number {
    return this.#store!.size;
  }
  static hits(): number {
    return Cache.#shared!.hits;
  }
}
const lines: string[] = [];
for (const run of [() => new Cache().size(), () => Cache.hits()]) {
  try {
    lines.push("no error " + run());
  } catch (thrown) {
    const error = thrown as Error & { line: number; column: number };
    lines.push(error.name + ": " + error.message + " [" + error.line + ":" + error.column + "]");
  }
}
console.log(lines.join("\n"));
