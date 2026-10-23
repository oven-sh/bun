import * as self from "./a-module-lists-the-keys-of-its-own-namespace.mjs";
const said = [];
said.push("width " + String(self.width));
said.push("own keys " + Reflect.ownKeys(self).map(String).join());
console.log(said.join(" | "));
export var width = 30;
export let height = 40;
