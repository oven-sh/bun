// Untyped programs: a create server. It prints what plain Bun prints.
import http from "node:http";
const server = http.createServer((request, response) => { response.end("x"); });
console.log(typeof server);
