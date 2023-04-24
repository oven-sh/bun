import { file, write } from "bun";
import { mkdirSync } from "fs";
import { join, resolve } from "path";
import { getDotTsFiles } from "./utils/getDotTsFiles";

// Combine all the .d.ts files into a single .d.ts file
// so that your editor loads the types faster
const BUN_VERSION = (
  process.env.BUN_VERSION ||
  Bun.version ||
  process.versions.bun
).replace(/^.*v/, "");
const folder = resolve(process.argv.at(-1)!);
if (folder.endsWith("bundle.ts")) {
  throw new Error("Pass a folder");
}

try {
  mkdirSync(folder, { recursive: true });
} catch (err) {
  err;
}

const header = await file(join(import.meta.dir, "..", "header.txt")).text();
const filesToCat = (await getDotTsFiles("./")).filter(
  f => !["./index.d.ts"].some(tf => f === tf),
);

const fileContents: string[] = [];

for (let i = 0; i < filesToCat.length; i++) {
  const name = filesToCat[i];
  fileContents.push(
    "// " +
      name +
      "\n\n" +
      (await file(resolve(import.meta.dir, "..", name)).text()) +
      "\n",
  );
}

const text = header.replace("{version}", BUN_VERSION) + fileContents.join("\n");

const destination = resolve(folder, "types.d.ts");
await write(destination, text);

const packageJSON = {
  name: process.env.PACKAGE_NAME || "bun-types",
  version: BUN_VERSION,
  description:
    "Type definitions for Bun, an incredibly fast JavaScript runtime",
  types: "types.d.ts",
  files: ["types.d.ts", "README.md", "tsconfig.json"],
  private: false,
  keywords: ["bun", "bun.js", "types"],
  repository: "https://github.com/oven-sh/bun",
  homepage: "https://bun.sh",
};

await write(
  resolve(folder, "package.json"),
  JSON.stringify(packageJSON, null, 2) + "\n",
);

const tsConfig = {
  compilerOptions: {
    lib: ["ESNext"],
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "bundler",
    moduleDetection: "force",
    resolveJsonModule: true,
    strict: true,
    downlevelIteration: true,
    skipLibCheck: true,
    jsx: "react-jsx",
    allowImportingTsExtensions: true,
    allowSyntheticDefaultImports: true,
    forceConsistentCasingInFileNames: true,
    allowJs: true,
    types: ["bun-types"],
  },
};

await write(
  resolve(folder, "tsconfig.json"),
  JSON.stringify(tsConfig, null, 2) + "\n",
);

await write(
  resolve(folder, "README.md"),
  file(resolve(import.meta.dir, "..", "README.md")),
);

export {};

import "../index";
