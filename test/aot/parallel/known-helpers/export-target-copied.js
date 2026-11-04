var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var entry = {};
__export(entry, { getRouter: () => getRouter, other: () => other });
function getRouter() { return { routes: ["a", "b"] }; }
function other() { return 5; }
async function load() { return entry; }
const copy = Object.assign({}, entry);
const { getRouter: taken } = entry;
const spread = { ...entry };
let names = [];
for (const key in entry) names.push(key + ":" + typeof entry[key]);
load().then(module => {
  console.log(module.getRouter().routes.length, copy.getRouter().routes.length, taken().routes.length, spread.other(), names.join(), Object.keys(entry).length, JSON.stringify(Object.getOwnPropertyDescriptor(entry, "other").enumerable));
});
