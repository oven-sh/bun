var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var entry = {};
__export(entry, { getRouter: () => getRouter, version: () => version });
function getRouter() { return { routes: ["a", "b"] }; }
var version = 7;
globalThis.stash = entry;
const back = globalThis[process.argv.length > 100 ? "nothing" : ["sta", "sh"].join("")];
console.log(back.getRouter().routes.length, back.version);
