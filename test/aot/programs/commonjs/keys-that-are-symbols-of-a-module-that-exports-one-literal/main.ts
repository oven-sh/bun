// `const { kValue } = require("./keys.cjs")`, where keys.cjs makes one literal of symbols and stores it into module.exports: the idiom of many packages for their private names.
// The names are constants for whoever reads them while nothing has been stored under them again, and every other way through the same modules gives what plain JavaScript gives.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const out: string[] = [];
const suffix = process.argv[2] ?? "";
const hide = new Function("value", "return value" + suffix) as <V>(value: V) => V;
const storeUnseen = new Function("object", "key", "value", "object[key] = value" + suffix) as (object: object, key: PropertyKey, value: unknown) => void;

const keys = require("./keys.cjs");
const Thing = require("./thing.cjs");
const things: any[] = [];
for (let i = 0; i < 6; i++) things.push(hide(new Thing(i)));
for (let i = 0; i + 1 < things.length; i++) things[i].link(things[i + 1]);
let sum = 0;
for (let turn = 0; turn < 500; turn++) for (const thing of things) sum += thing.touch();
out.push(`sum ${sum}, count ${things[3].count()}, length ${things[0].length()} ${things[4].length()}`);
out.push("own symbols: " + Object.getOwnPropertySymbols(things[0]).map(String).join());
out.push("own names: " + JSON.stringify(Object.keys(things[0])) + " " + JSON.stringify(things[0]));
out.push(`through the literal: ${things[2][keys.kValue]} ${things[2][keys.kCount]} ${things[2][keys.kNext] === things[3]}`);
out.push(`the same literal again: ${require("./keys.cjs") === keys} ${Object.keys(keys).join()}`);
out.push(`another symbol of the same description finds nothing: ${things[2][Symbol("thing.value")]}`);

storeUnseen(things[1], keys.kValue, "stored by code that nobody sees");
delete things[2][keys.kCount];
Object.defineProperty(things[3], keys.kValue, { get: () => "from a getter", configurable: true });
out.push(`after changes: ${things[1].touch()} | ${things[2].touch()} ${things[2].count()} | ${things[3].touch()} | ${things[4].touch()}`);

const replacement = Symbol("replacement");
keys.kChanged = replacement;
storeUnseen(keys, "kAdded", Symbol("added"));
delete keys.kRemoved;
const marked = hide(new Thing("marked"));
marked[replacement] = "under the replacement";
out.push("a module loaded after the literal has changed: " + require("./late.cjs")(marked));

const cycle = require("./cycle.cjs");
out.push(`a module that requires itself: early ${cycle.early} | late ${cycle.late()} | ${String(cycle.kInside)}`);
const kept = require("./first-object-kept.cjs");
out.push(`the first exports object: ${Object.keys(kept).join()} | ${Object.keys(kept.first).join()} | ${String(kept.first.onFirst)} | ${kept.isThis} | ${kept.first === kept}`);
console.log(out.join("\n"));
