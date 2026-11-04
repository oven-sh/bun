// The program loads a plug-in under a name that the build cannot know. A path is spelled only in a branch that the build removes, so nothing can hand it to the load, and the unused exports of the file stay out of the executable.
// STATISTIC: ImageFunctionsEmitted <= 100
import { name } from "./lib/part.mjs";
const off = false;
const removed = off ? require("./lib/part.mjs") : null;
console.log(name, removed);
const plugin = process.env.PLUGIN;
if (plugin) console.log(Object.keys(await import(plugin)).length);
