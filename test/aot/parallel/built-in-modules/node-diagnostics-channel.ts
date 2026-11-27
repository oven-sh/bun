import * as library from "node:diagnostics_channel";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
const channel = library.channel("a");
channel.subscribe((message: any) => console.log(message.value));
channel.publish({ value: 3 });
