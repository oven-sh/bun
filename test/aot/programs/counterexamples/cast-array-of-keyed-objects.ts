// Objects that are built by a computed key are collected in an array, and the array is cast to an array of records.
declare const console: { log(...values: unknown[]): void };
function rows<T extends Record<string, readonly unknown[]>>(dims: T): Array<{ [K in keyof T]: T[K][number] }> {
  const out: Array<Record<string, unknown>> = [];
  for (const k of Object.keys(dims)) for (const v of dims[k]) out.push({ [k]: v });
  return out as Array<{ [K in keyof T]: T[K][number] }>;
}
for (const { a } of rows({ a: [1, 2] as const })) console.log(a);
