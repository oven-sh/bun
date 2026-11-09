// RUN: lower
// OPTIONS: builtin-modules

// A table typed by a mapped type over a union of names, where one whole row comes from JSON.parse.
declare const console: { log(...a: unknown[]): void };
type Names = "A" | "B" | "C";
interface PropsOf {
  A: { p?: string; z: number };
  B: { q: boolean };
  C: { q: boolean; r: string | null };
}
const ANY = "any" as const;
const OTHER: ReadonlyArray<string> = ["t", "f"];
export const TABLE: Readonly<Partial<Record<Names, Readonly<Record<string, ReadonlyArray<string> | typeof ANY>>>>> = {
  A: { p: ["a string", "missing"] },
  B: { q: OTHER },
  C: { q: OTHER, r: ANY },
} satisfies {
  readonly [N in Names]?: { readonly [K in keyof PropsOf[N]]?: ReadonlyArray<string> | typeof ANY };
};
console.log(Object.keys(TABLE).join(), JSON.stringify(TABLE));
for (const n of Object.keys(TABLE) as Names[]) {
  const row = TABLE[n]!;
  for (const k of Object.keys(row)) console.log(n, k, typeof row[k] === "string" ? row[k] : row[k].length);
}
const given2 = JSON.parse(`{"p":["x"]}`) as { readonly p?: ReadonlyArray<string> | typeof ANY };
console.log(JSON.stringify(given2.p));
