// Hardcoded module "node:stream/promises"
// As in Node.js, node:stream loads with it. Not the `promises` of node:stream: a program can delete or replace that.
require("node:stream");
export default require("internal/stream.promises");
