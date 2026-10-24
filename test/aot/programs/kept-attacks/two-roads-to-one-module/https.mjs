// Two roads to one module, one probe of many. It prints what plain Bun prints.
import * as space from "node:https";
import whole from "node:https";
import { Agent as named_Agent, Server as named_Server, createServer as named_createServer, get as named_get, globalAgent as named_globalAgent, request as named_request } from "node:https";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:https");
const asked = process.getBuiltinModule("node:https");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("Agent", named_Agent === space.Agent, named_Agent === whole.Agent, named_Agent === required.Agent, named_Agent === asked.Agent, space.Agent === required.Agent, whole.Agent === required.Agent, asked.Agent === required.Agent, whole.Agent === space.Agent);
same("Server", named_Server === space.Server, named_Server === whole.Server, named_Server === required.Server, named_Server === asked.Server, space.Server === required.Server, whole.Server === required.Server, asked.Server === required.Server, whole.Server === space.Server);
same("createServer", named_createServer === space.createServer, named_createServer === whole.createServer, named_createServer === required.createServer, named_createServer === asked.createServer, space.createServer === required.createServer, whole.createServer === required.createServer, asked.createServer === required.createServer, whole.createServer === space.createServer);
same("get", named_get === space.get, named_get === whole.get, named_get === required.get, named_get === asked.get, space.get === required.get, whole.get === required.get, asked.get === required.get, whole.get === space.get);
same("globalAgent", named_globalAgent === space.globalAgent, named_globalAgent === whole.globalAgent, named_globalAgent === required.globalAgent, named_globalAgent === asked.globalAgent, space.globalAgent === required.globalAgent, whole.globalAgent === required.globalAgent, asked.globalAgent === required.globalAgent, whole.globalAgent === space.globalAgent);
same("request", named_request === space.request, named_request === whole.request, named_request === required.request, named_request === asked.request, space.request === required.request, whole.request === required.request, asked.request === required.request, whole.request === space.request);
