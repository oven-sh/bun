// bun gen.ts : writes the measurement fixtures under ./fix
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
const write = (root: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
};
const options = (more: object) => ({ strict: true, lib: ["esnext"], ...more });
const project = (name: string, more: object, files: Record<string, string>) =>
  write(join("fix", name), {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { ...options(more), module: "esnext", moduleResolution: "bundler", target: "esnext", types: [], noEmit: true },
    }),
    "package.json": JSON.stringify({ name, version: "1.0.0", compilerOptions: options(more) }),
    ...files,
  });
project("sources", { skipLibCheck: false }, {
  "src/index.ts": `import { area } from "./area";
export interface Shape {
  kind: "circle" | "square";
  size: number;
}
export class Canvas {
  #shapes: Shape[] = [];
  add(shape: Shape): this {
    this.#shapes.push(shape);
    return this;
  }
  total(): number {
    let sum = 0;
    for (const shape of this.#shapes) sum += area(shape);
    return sum;
  }
}
export { area };
`,
  "src/area.ts": `import type { Shape } from "./index";
export function area(shape: Shape): number {
  return shape.kind === "circle" ? Math.PI * shape.size ** 2 : shape.size ** 2;
}
`,
  "src/extra.ts": `import { area } from "./area";
export function double(size: number): number {
  return 2 * area({ kind: "square", size });
}
`,
});
const valued = (count: number) =>
  `export class Box {\n${Array.from({ length: count }, (_, i) => `  n${i} = ${i};\n`).join("")}  sum(): number { return this.n0; }\n}\n`;
const bare = (count: number) =>
  `export class Box {\n${Array.from({ length: count }, (_, i) => `  n${i};\n`).join("")}  constructor() {\n${Array.from({ length: count }, (_, i) => `    this.n${i} = ${i};\n`).join("")}  }\n  sum(): number { return this.n0; }\n}\n`;
const named = (count: number) =>
  `export class Item { a = 1; }\nexport class Box {\n${Array.from({ length: count }, (_, i) => `  n${i};\n`).join("")}  constructor() {\n${Array.from({ length: count }, (_, i) => `    this.n${i} = new Item();\n`).join("")}  }\n  sum(): number { return this.n0.a; }\n}\n`;
project("define200", {}, { "src/index.ts": valued(200) });
project("definebare200", {}, { "src/index.ts": bare(200) });
project("definenamed200", {}, { "src/index.ts": named(200) });
for (const count of [1, 20, 200]) project(`assign${count}`, { useDefineForClassFields: false }, { "src/index.ts": valued(count) });
const namedValued = (count: number) =>
  `export class Item { a = 1; }\nexport class Box {\n${Array.from({ length: count }, (_, i) => `  n${i} = new Item();\n`).join("")}  sum(): number { return this.n0.a; }\n}\n`;
project("assignnamed200", { useDefineForClassFields: false }, { "src/index.ts": namedValued(200) });
