import { viaDeclaration } from "./chunk.mjs";
export let early;
try {
  early = viaDeclaration();
} catch (error) {
  early = error.name;
}
