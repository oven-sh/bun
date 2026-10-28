// Functions read constants that are declared at the top of their files, and throw. The program prints the frames of each error.
import aboveItsDeclaration from "./above-its-declaration.cjs";
import behindACall from "./behind-a-call.cjs";
import behindAVariable from "./behind-a-variable.cjs";
import * as behindAnImport from "./behind-an-import.mjs";
import memberOfExports from "./member-of-exports.cjs";
import * as module from "./module.mjs";
import numbers from "./numbers.cjs";
import objectAtTheEnd from "./object-at-the-end.cjs";
import * as typed from "./typed.ts";
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    const frames = String(error.stack)
      .split("\n")
      .map(text => /^\s*at (.*?) ?\(?[^ ()]*[\/\\]([\w.-]+):(\d+):(\d+)\)?$/.exec(text))
      .filter(found => found !== null)
      .map(found => found[1] + "@" + found[2] + ":" + found[3] + ":" + found[4]);
    console.log(label, "|", frames[0]);
  }
}
show("an object at the end", () => void objectAtTheEnd.read());
show("a member of exports", () => void memberOfExports.read());
show("a module", () => void module.read());
show("behind an import", () => void behindAnImport.read());
show("behind a variable", () => void behindAVariable.read());
show("ahead of a call", () => void behindACall.read());
show("behind a call", () => void behindACall.readSecond());
show("above its declaration", () => void aboveItsDeclaration.read());
show("typed", () => void typed.read());
show("typed, an argument", () => void typed.call(null));
show("an argument", () => void numbers.read(null));
show("a text", () => void numbers.readSecond());
