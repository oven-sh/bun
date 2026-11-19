import { open } from "node:fs/promises";
const handle = await open("/etc/hostname");
const proto = Object.getPrototypeOf(handle); const was = proto[Symbol.asyncDispose];
proto[Symbol.asyncDispose] = async function () { console.log("the program first"); return was.call(this); };
{ await using again = handle; console.log(again.fd > 0); }
console.log(handle.fd);
