// Two roads to one module: http client. It prints what plain Bun prints.
import * as space from "node:_http_client";
import whole from "node:_http_client";
import { ClientRequest as named_ClientRequest } from "node:_http_client";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:_http_client");
const asked = process.getBuiltinModule("node:_http_client");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("ClientRequest", named_ClientRequest === space.ClientRequest, named_ClientRequest === whole.ClientRequest, named_ClientRequest === required.ClientRequest, named_ClientRequest === asked.ClientRequest, space.ClientRequest === required.ClientRequest, whole.ClientRequest === required.ClientRequest, asked.ClientRequest === required.ClientRequest, whole.ClientRequest === space.ClientRequest);
