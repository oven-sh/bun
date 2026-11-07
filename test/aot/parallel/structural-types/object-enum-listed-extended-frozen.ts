// The object of an enum is listed extended frozen and merged.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

enum Level {
  Low,
  High = 5,
  Text = "text",
}

function keysOf(value: object): string[] {
  return Object.keys(value);
}
function countOf(table: Record<string, string | number>): number {
  let count = 0;
  for (const key in table) if (typeof table[key] === "number") count++;
  return count;
}
function read(table: { readonly Low: number; readonly High: number }): number {
  return table.Low * 10 + table.High;
}

attempt("keys", () => keysOf(Level));
attempt("values", () => Object.values(Level));
attempt("for in", () => {
  const keys: string[] = [];
  for (const key in Level) keys.push(key);
  return keys;
});
attempt("as a table", () => [countOf(Level), read(Level), JSON.stringify(Level)]);
attempt("spread and assigned", () => [{ ...Level }, Object.assign({}, Level), structuredClone(Level)]);
attempt("what it is", () => [typeof Level, Object.getPrototypeOf(Level) === Object.prototype, Object.isFrozen(Level), Object.isExtensible(Level), String(Level)]);
attempt("extended", () => {
  const wider = Object.assign(Level, { Extra: 9 });
  return [wider === Level, wider.Extra, keysOf(Level), "Extra" in Level];
});
attempt("a member becomes an accessor", () => {
  let reads = 0;
  Object.defineProperty(Level, "High", { get: () => 100 + reads++, enumerable: true, configurable: true });
  const name: "High" | "Low" = keysOf(Level).includes("High") ? "High" : "Low";
  return [Level.High, Level[name], Level[name], read(Level), reads];
});
attempt("merged after it was frozen", () => {
  enum Part {
    A,
  }
  Object.freeze(Part);
  const before = keysOf(Part);
  enum Part {
    B = 1,
  }
  return [before, keysOf(Part), Part.B];
});
attempt("what the frozen one holds", () => {
  enum Part {
    A,
  }
  Object.freeze(Part);
  const view: { A: number } = Part;
  let threw = "no";
  try {
    view.A = 5;
  } catch (error) {
    threw = error instanceof Error ? error.constructor.name : typeof error;
  }
  return [threw, Part.A, view.A, Part[0], Part[5]];
});
attempt("made anew by each call", () => {
  function make(): object {
    enum Local {
      A,
      B,
    }
    return Local;
  }
  const first = make();
  const second = make();
  Object.assign(first, { C: 2 });
  return [first === second, keysOf(first), keysOf(second)];
});
