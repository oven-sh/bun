import * as library from "node:string_decoder";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(new library.StringDecoder("utf8").write(Buffer.from([0xc3, 0xbc])));
