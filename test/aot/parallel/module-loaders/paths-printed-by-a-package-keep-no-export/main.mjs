// The program loads a plug-in under a name that the build cannot know. A package that lies behind another package lists the paths of its own files as strings and never loads them: nothing that has to do with the load imports it, so its unused exports stay out of the executable.
// STATISTIC: ImageFunctionsEmitted <= 110
import { first, list, second } from "wrapper";
console.log(list.join(), first("a"), second("b"));
const plugin = process.env.PLUGIN;
if (plugin) console.log(Object.keys(await import(plugin)).length);
