// util.inspect() of an error with colors marks the frames of built-in modules, of node_modules and of the working directory: it asks for the list of built-in modules and for the working directory as a file URL. A list that the program changed is obeyed.
import { inspect } from "node:util";
import Module from "node:module";
import { pathToFileURL } from "node:url";

const here = process.cwd();
function failed(stack: string[]): Error {
  const error = new Error("failed");
  error.stack = "Error: failed\n" + stack.map(frame => "    at " + frame).join("\n");
  return error;
}
const show = (error: Error) => console.log(JSON.stringify(inspect(error, { colors: true }).replaceAll(here, "<cwd>").replaceAll(pathToFileURL(here).href, "<cwd url>")));
const frames = [
  "run (node:internal/process/task_queues:95:5)",
  "read (node:fs:10:1)",
  "made up (node:made-up:1:1)",
  `mine (${here}/src/mine.js:1:2)`,
  `theirs (${here}/node_modules/theirs/index.js:3:4)`,
  `module (${pathToFileURL(here).href}/src/module.mjs:5:6)`,
  "elsewhere (/somewhere/else.js:7:8)",
];
show(failed(frames));
(Module.builtinModules as string[]).push("made-up");
show(failed(frames));
(Module.builtinModules as string[]).pop();
console.log(inspect(failed(frames)).replaceAll(here, "<cwd>").replaceAll(pathToFileURL(here).href, "<cwd url>"));
for (const options of [1, null, [], () => {}, "text"]) {
  for (const name of ["defaultOptions", "replDefaults"] as const) {
    try {
      (inspect as any)[name] = options;
      console.log(name, "taken");
    } catch (error) {
      console.log(name, (error as any).code, (error as Error).message);
    }
  }
}
