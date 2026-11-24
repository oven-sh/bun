// The entry point awaits nothing at its top level: the host starts it; what it imports by statements runs in front of it, what it imports by a name made at run time runs behind it.
import { value as below } from "./below.ts";
const log: string[] = (globalThis as any).log;
log.push("main runs over " + below);
const names = ["late-a", "late-b", "late-a", "below"];
let chain: Promise<unknown> = Promise.resolve();
for (const name of names) chain = chain.then(() => import("./" + name + ".ts")).then(loaded => { log.push("loaded " + name + " " + loaded.value); });
chain.then(() => { console.log(log.join("\n")); });
log.push("main ends");
