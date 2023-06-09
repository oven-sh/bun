// Hardcoded module "node:https"
export * from "node:http";
const HTTP = import.meta.require("node:http");
export default HTTP;
