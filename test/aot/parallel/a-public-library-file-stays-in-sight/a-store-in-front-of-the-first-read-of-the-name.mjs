// The first read of the member through the name comes behind the store.
import fs, { existsSync } from "node:fs";
fs.existsSync = () => "mine";
console.log(existsSync("/"), fs.existsSync("/"));
