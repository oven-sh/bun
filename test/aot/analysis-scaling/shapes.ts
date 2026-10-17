export type Shape = {
  name: string;
  counted: string;
  sizes: number[];
  instructionsPerItem: number;
  bytesPerItem: number;
  write(count: number): Record<string, string>;
};

function unionOfGenericClasses(methods: number, functions: number) {
  const variants = ["First", "Second"];
  const method = (variant: string, index: number) =>
    [
      `  map${index}<A>(f: (value: T) => A): Either<A, E> { return new ${variant}<A, E>(f(this.held as T)); }`,
      `  mapError${index}<F>(f: (error: E) => F): Either<T, F> { return new ${variant}<T, F>(f(this.held as E)); }`,
      `  then${index}<U, F>(f: (value: T) => Either<U, F>): Either<U, E | F> { return f(this.held as T); }`,
    ][index % 3];
  const classes = variants.map(
    variant => `export class ${variant}<T, E> {\n  constructor(readonly held: T | E) {}\n${Array.from({ length: methods }, (_, index) => method(variant, index)).join("\n")}\n}`,
  );
  const makers = Array.from({ length: functions }, (_, index) => `export function make${index}(n: number): Either<number, string> { return new ${variants[index % 2]}<number, string>(n + ${index}); }`);
  return `export type Either<T, E> = ${variants.map(variant => `${variant}<T, E>`).join(" | ")};\n${classes.join("\n")}\n${makers.join("\n")}\n`;
}

function declaredInterfaceOverConditionalTypes(properties: number) {
  const indexes = Array.from({ length: properties }, (_, index) => index);
  let deepType = "number";
  let deepValue = "1";
  for (let depth = 0; depth < 10; depth++) {
    deepType = `Box<${deepType}>`;
    deepValue = `{ held: ${deepValue} }`;
  }
  return {
    "node_modules/chain/package.json": `{ "name": "chain", "version": "1.0.0", "type": "module", "main": "index.js", "types": "index.d.ts" }\n`,
    "node_modules/chain/index.js": `export function inspect(value) {\n  return { value };\n}\n`,
    "node_modules/chain/index.d.ts": `${indexes.map(index => `export type Unwrap${index}<T> = T extends { p${index}: infer P } ? P : never;\n`).join("")}export interface Chain<T> {\n  value: T;\n${indexes.map(index => `  p${index}: Chain<Unwrap${index}<T>>;\n`).join("")}}\nexport declare function inspect<T>(value: T): Chain<T>;\n`,
    "main.ts": `import { inspect } from "chain";\ntype Box<T> = { held: T };\nconst deep: ${deepType} = ${deepValue};\nexport const kind = typeof inspect(deep).value;\n`,
  };
}

export const shapes: Shape[] = [
  {
    name: "union of generic classes with generic methods",
    counted: "methods of each class",
    sizes: [1, 2, 4],
    instructionsPerItem: 40_000_000,
    bytesPerItem: 4 * 1024 * 1024,
    write: count => ({ "main.ts": unionOfGenericClasses(count, 1) }),
  },
  {
    name: "functions returning a generic class as a union",
    counted: "functions",
    sizes: [4, 16, 64],
    instructionsPerItem: 10_000_000,
    bytesPerItem: 1024 * 1024,
    write: count => ({ "main.ts": unionOfGenericClasses(2, 1 + count) }),
  },
  {
    name: "declared interface recursing through conditional types",
    counted: "properties",
    sizes: [1, 2, 3, 12],
    instructionsPerItem: 10_000_000,
    bytesPerItem: 1024 * 1024,
    write: declaredInterfaceOverConditionalTypes,
  },
];
