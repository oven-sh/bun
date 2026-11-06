// A library waits one job so that its importer may set it up: the importer's body runs first.
import { configure, onReady, options, seen } from "./library.mjs";
configure("what the program asked for");
onReady(() => console.log("the program hears ready"));
options.retries = 5;
seen.then(retries => console.log("the library read", retries, "retries"));
