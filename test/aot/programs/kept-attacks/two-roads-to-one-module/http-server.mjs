// Two roads to one module: http server. It prints what plain Bun prints.
import * as space from "node:_http_server";
import whole from "node:_http_server";
import { Server as named_Server, ServerResponse as named_ServerResponse, kConnectionsCheckingInterval as named_kConnectionsCheckingInterval } from "node:_http_server";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:_http_server");
const asked = process.getBuiltinModule("node:_http_server");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("Server", named_Server === space.Server, named_Server === whole.Server, named_Server === required.Server, named_Server === asked.Server, space.Server === required.Server, whole.Server === required.Server, asked.Server === required.Server, whole.Server === space.Server);
same("ServerResponse", named_ServerResponse === space.ServerResponse, named_ServerResponse === whole.ServerResponse, named_ServerResponse === required.ServerResponse, named_ServerResponse === asked.ServerResponse, space.ServerResponse === required.ServerResponse, whole.ServerResponse === required.ServerResponse, asked.ServerResponse === required.ServerResponse, whole.ServerResponse === space.ServerResponse);
same("kConnectionsCheckingInterval", named_kConnectionsCheckingInterval === space.kConnectionsCheckingInterval, named_kConnectionsCheckingInterval === whole.kConnectionsCheckingInterval, named_kConnectionsCheckingInterval === required.kConnectionsCheckingInterval, named_kConnectionsCheckingInterval === asked.kConnectionsCheckingInterval, space.kConnectionsCheckingInterval === required.kConnectionsCheckingInterval, whole.kConnectionsCheckingInterval === required.kConnectionsCheckingInterval, asked.kConnectionsCheckingInterval === required.kConnectionsCheckingInterval, whole.kConnectionsCheckingInterval === space.kConnectionsCheckingInterval);
