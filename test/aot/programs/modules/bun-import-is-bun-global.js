// An import of "bun" that is written as a string literal stands for the global `Bun` object itself, not for a module namespace object.
import * as star from "bun";
import def from "bun";
import { version } from "bun";

const tell = (name, value) => console.log(name + ": " + value);
const dynamic = await import("bun");
tell("import() is Bun", dynamic === Bun);
tell("import().default", typeof dynamic.default);
tell("the default import is Bun", def === Bun);
tell("the namespace import is Bun", star === Bun);
tell("the namespace import has no default", typeof star.default);
tell("the namespace import and import() are one", star === dynamic);
tell("a named import", version === Bun.version);
tell("a member of the namespace import", star.version === Bun.version);
tell("require() is Bun", require("bun") === Bun);
tell("Object.prototype.toString", Object.prototype.toString.call(dynamic));
tell("then", await import("bun").then(bun => bun === Bun));
const name = "bun";
tell("a computed specifier yields a namespace object", Object.prototype.toString.call(await import(name)));
tell("whose default is Bun", (await import(name)).default === Bun);
