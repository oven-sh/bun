import { unwatchFile, watchFile } from "node:fs";

watchFile("/no/such/file", { interval: 1000, persistent: false }, () => {});
unwatchFile("/no/such/file");
console.log("unwatched");
