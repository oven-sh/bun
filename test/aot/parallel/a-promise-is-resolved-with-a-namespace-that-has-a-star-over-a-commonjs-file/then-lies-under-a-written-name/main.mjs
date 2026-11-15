import * as space from "./barrel.mjs";
async function nothing() { return 0; }
function later(value) { return nothing().then(function () { return value; }); }
async function main() { const got = await later(space); console.log(typeof got, got.beside); }
main();
