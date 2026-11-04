// by other roads
import viaModule from "node:process";
import { env as named } from "node:process";
const { env } = process;
console.log(env === process.env, viaModule.env === process.env, named === process.env, globalThis.process.env === env, require("process").env === env, process?.env === env, process["env"] === env);
