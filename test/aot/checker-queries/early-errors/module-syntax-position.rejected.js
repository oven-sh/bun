// import and export declarations below the top level of the module.
{ import "node:fs"; }
function f() { import "node:fs"; }
{ export {}; }
if (1) { export default 1; }
function f() { export const a = 1; }
{ export * from "node:fs"; }
