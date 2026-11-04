import http from "node:http";
import * as bun from "bun";
import * as sqlite from "bun:sqlite";
import * as fs from "fs";
import { WebSocketServer } from "ws";
const names = ["undici", "ws", "node:http", "http", "bun", "bun:sqlite", "fs", "node:fs"];
console.log(names.map(name => `${name} ${name in require.cache} ${typeof require.cache[name]}`).join(", "));
console.log(typeof http, typeof bun, typeof sqlite, typeof fs, typeof WebSocketServer);
