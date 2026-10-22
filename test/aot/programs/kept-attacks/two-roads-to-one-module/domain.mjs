// Two roads to one module, one probe of many. It prints what plain Bun prints.
import * as space from "node:domain";
import whole from "node:domain";
import { active as named_active, create as named_create, createDomain as named_createDomain } from "node:domain";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:domain");
const asked = process.getBuiltinModule("node:domain");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("active", named_active === space.active, named_active === whole.active, named_active === required.active, named_active === asked.active, space.active === required.active, whole.active === required.active, asked.active === required.active, whole.active === space.active);
same("create", named_create === space.create, named_create === whole.create, named_create === required.create, named_create === asked.create, space.create === required.create, whole.create === required.create, asked.create === required.create, whole.create === space.create);
same("createDomain", named_createDomain === space.createDomain, named_createDomain === whole.createDomain, named_createDomain === required.createDomain, named_createDomain === asked.createDomain, space.createDomain === required.createDomain, whole.createDomain === required.createDomain, asked.createDomain === required.createDomain, whole.createDomain === space.createDomain);
