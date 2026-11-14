// import.meta.resolve of a name that the build chose among and that only the tsconfig explains answers the file, also in a module that hands its import.meta to a function and in one that keeps import.meta.resolve bound.
import { askBesideABoundCopy, kept } from "~lib/bound";
import { o } from "~lib/other";
import { tail } from "~lib/tail";
import { w } from "~lib/thing";

const take = (meta: ImportMeta) => typeof meta.url;
const names = process.argv.length > 5 ? ["./lib/thing.ts"] : ["~lib/thing", "~lib/other"];

console.log(w + o, take(import.meta), typeof kept);
for (const name of names) console.log(name, tail(() => import.meta.resolve(name)));
console.log(askBesideABoundCopy().join(" "));
