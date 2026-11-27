// The namespace of a compiled module is no JSModuleNamespaceObject.
import * as other from "./other.mjs";
function* generator() {}
async function* asyncGenerator() {}
for (const held of [other, generator(), asyncGenerator()]) {
  try {
    queueMicrotask(held);
  } catch (error) {
    console.log(error.message);
  }
}
