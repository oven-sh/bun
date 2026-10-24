// The program never names node:dgram; a package it uses requires it by name. That keeps the module, and the program's computed name finds it. The output is that of plain Bun.
import { socketType } from "uses-dgram";

console.log(socketType());
console.log(typeof require(process.env.NAME).createSocket);
