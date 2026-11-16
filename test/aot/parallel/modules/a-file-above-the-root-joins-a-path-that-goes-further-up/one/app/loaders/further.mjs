import path from "node:path";
import "../../texts/en.json";
import "../../others/en.json";
const kept = {};
export const keptInAnObject = name => {
  kept[name] = path.join(import.meta.dirname, "../../texts", name + ".json");
  return import(kept[name]);
};
export const whateverIsHandedIn = rest => import(path.join(import.meta.dirname, rest));
export const belowTheWrittenFolder = name => import(path.join(import.meta.dirname, "../../texts", name + ".json"));
export const resolvedBelowTheWrittenFolder = file => import(path.resolve(import.meta.dirname, "../../texts", file));
