// `./lib/counter.mjs?first` is one more module of lib/counter.mjs: it runs the text again, has variables of its own, and is the same module
// for everybody who writes the same query, whether in a statement or in import(). `bun build --compile` finds no such path: the program is held to `bun run`.
import * as plain from "./lib/counter.mjs";
import * as first from "./lib/counter.mjs?first";
import * as second from "./lib/counter.mjs?second";
import * as firstAgain from "./lib/counter.mjs?first";
import * as withoutExtension from "./lib/counter?first";
import * as emptyQuery from "./lib/counter.mjs?";
import * as twoMarks from "./lib/counter.mjs?a?b#c";
import * as otherCase from "./lib/counter.mjs?FIRST";
import { bump as bumpFirst, read as readFirst } from "./lib/counter.mjs?first";
import { handedOn } from "./lib/hands-on.mjs";
import typed, { where as whereTyped } from "./lib/typed.ts?one";

const show = module => [module.order, module.url, module.path, module.file, module.dir, module.main, module.shared].join(" ");
for (const module of [plain, first, second, withoutExtension, emptyQuery, twoMarks, otherCase]) console.log(show(module));
console.log(first === firstAgain, first === withoutExtension, first === plain, first === second, emptyQuery === plain, otherCase === first);

bumpFirst();
bumpFirst();
second.bump();
console.log(readFirst(), first.read(), second.read(), plain.read());

const called = await import("./lib/counter.mjs?first");
const onlyCalled = await import("./lib/counter.mjs?only-called");
console.log(called === first, show(onlyCalled), onlyCalled.read());
console.log(show(handedOn));

console.log(typed, whereTyped);

// A stack trace names the file.
try {
  first.fail();
} catch (error) {
  const frame = error.stack.split("\n")[1];
  console.log(frame.replaceAll("\\", "/").replace(/.*\/lib/, "lib"));
}

for (const load of [() => import("./lib/missing.mjs?x"), () => import("node:fs?x")]) {
  try {
    await load();
    console.log("loaded");
  } catch (error) {
    console.log(error.code, error.message.split("\n")[0].replace(/ (imported )?from .*/, ""));
  }
}
