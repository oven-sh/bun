// What an import with { type: "file" } gives names the file wherever it goes: to require.resolve() and its kin and to what reads files, straight, through a constant, another file, a name exported again or a namespace object.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import direct from "./carried.json" with { type: "file" };
import * as all from "./carried.json" with { type: "file" };
import handedOn, { again, kept, whole } from "./between.ts";

const alias = direct;
const made = createRequire(import.meta.url);
const url = Bun.pathToFileURL(direct).href;
const found = (way: string, byRequire: string, byMadeRequire: string, byImportMeta: string) =>
  console.log(way, byRequire === direct, byMadeRequire === direct, byImportMeta === url);

found("straight", require.resolve(direct), made.resolve(direct), import.meta.resolve(direct));
found("a constant", require.resolve(alias), made.resolve(alias), import.meta.resolve(alias));
found("another file", require.resolve(kept), made.resolve(kept), import.meta.resolve(kept));
found("a default export", require.resolve(handedOn), made.resolve(handedOn), import.meta.resolve(handedOn));
found("exported again", require.resolve(again), made.resolve(again), import.meta.resolve(again));
found("a namespace", require.resolve(all.default), made.resolve(all.default), import.meta.resolve(all.default));
found("handed on", require.resolve(whole.default), made.resolve(whole.default), import.meta.resolve(whole.default));
found("a template", require.resolve(`${direct}`), made.resolve(`${direct}`), import.meta.resolve(`${direct}`));

console.log(Bun.resolveSync(direct, import.meta.dir) === direct, Bun.resolveSync(kept, import.meta.dir) === direct);
console.log(existsSync(direct), JSON.parse(readFileSync(kept, "utf8")).kind, (await Bun.file(again).json()).kind);
