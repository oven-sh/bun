import { createRequire } from "node:module";
export const load = createRequire(import.meta.url);
export const askMember = () => load("./value.js").name;
export const askHeld = () => {
  const held = load("./value.js");
  return held.name;
};
export const askPattern = () => {
  const { name } = load("./value.js");
  return name;
};
