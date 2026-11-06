// Two roads to one module: http agent. It prints what plain Bun prints.
import * as space from "node:_http_agent";
import whole from "node:_http_agent";
import { Agent as named_Agent, globalAgent as named_globalAgent, shouldUseEnvProxy as named_shouldUseEnvProxy } from "node:_http_agent";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:_http_agent");
const asked = process.getBuiltinModule("node:_http_agent");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("Agent", named_Agent === space.Agent, named_Agent === whole.Agent, named_Agent === required.Agent, named_Agent === asked.Agent, space.Agent === required.Agent, whole.Agent === required.Agent, asked.Agent === required.Agent, whole.Agent === space.Agent);
same("globalAgent", named_globalAgent === space.globalAgent, named_globalAgent === whole.globalAgent, named_globalAgent === required.globalAgent, named_globalAgent === asked.globalAgent, space.globalAgent === required.globalAgent, whole.globalAgent === required.globalAgent, asked.globalAgent === required.globalAgent, whole.globalAgent === space.globalAgent);
same("shouldUseEnvProxy", named_shouldUseEnvProxy === space.shouldUseEnvProxy, named_shouldUseEnvProxy === whole.shouldUseEnvProxy, named_shouldUseEnvProxy === required.shouldUseEnvProxy, named_shouldUseEnvProxy === asked.shouldUseEnvProxy, space.shouldUseEnvProxy === required.shouldUseEnvProxy, whole.shouldUseEnvProxy === required.shouldUseEnvProxy, asked.shouldUseEnvProxy === required.shouldUseEnvProxy, whole.shouldUseEnvProxy === space.shouldUseEnvProxy);
