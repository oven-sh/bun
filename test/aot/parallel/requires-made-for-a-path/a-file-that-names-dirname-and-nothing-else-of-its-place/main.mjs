// A require made for a folder below `__dirname`, in files that name nothing else that a require or a path of the file comes from: no
// `require`, no `module`, no `__filename` and no `import.meta`. The build reads the folder there too, and the files are in the executable.
import sum from "./sum.mjs";
import typed from "./typed.ts";
import joined from "./joined.mjs";
import template from "./template.mjs";
import bare from "./bare.mjs";
import builtIn from "./built-in.cjs";
import folderOfUrl from "./folder-of-url.mjs";
import pathOfUrl from "./path-of-url.mjs";
console.log([sum, typed, joined, template, bare, builtIn.default, folderOfUrl, pathOfUrl].join(" "));
