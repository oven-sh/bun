// Two roads to one module: tls wrap. It prints what plain Bun prints.
import * as space from "node:_tls_wrap";
import whole from "node:_tls_wrap";
import { Server as named_Server, TLSSocket as named_TLSSocket, connect as named_connect, createServer as named_createServer } from "node:_tls_wrap";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:_tls_wrap");
const asked = process.getBuiltinModule("node:_tls_wrap");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("Server", named_Server === space.Server, named_Server === whole.Server, named_Server === required.Server, named_Server === asked.Server, space.Server === required.Server, whole.Server === required.Server, asked.Server === required.Server, whole.Server === space.Server);
same("TLSSocket", named_TLSSocket === space.TLSSocket, named_TLSSocket === whole.TLSSocket, named_TLSSocket === required.TLSSocket, named_TLSSocket === asked.TLSSocket, space.TLSSocket === required.TLSSocket, whole.TLSSocket === required.TLSSocket, asked.TLSSocket === required.TLSSocket, whole.TLSSocket === space.TLSSocket);
same("connect", named_connect === space.connect, named_connect === whole.connect, named_connect === required.connect, named_connect === asked.connect, space.connect === required.connect, whole.connect === required.connect, asked.connect === required.connect, whole.connect === space.connect);
same("createServer", named_createServer === space.createServer, named_createServer === whole.createServer, named_createServer === required.createServer, named_createServer === asked.createServer, space.createServer === required.createServer, whole.createServer === required.createServer, asked.createServer === required.createServer, whole.createServer === space.createServer);
