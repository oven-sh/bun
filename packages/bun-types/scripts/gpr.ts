/// <reference path="../index.d.ts" />
import { join } from "path";
// @ts-ignore
import pkg from "../dist/package.json";

const __dirname = new URL(".", import.meta.url).pathname;

pkg.name = `@oven-sh/${pkg.name}`;
await Bun.write(
  join(__dirname, "..", "dist", "package.json"),
  JSON.stringify(pkg),
);
