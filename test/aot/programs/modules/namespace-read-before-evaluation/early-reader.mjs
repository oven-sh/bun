import { getNamespace } from "./holder.mjs";
const namespace = getNamespace();
console.log("early-reader runs", Object.prototype.toString.call(namespace), typeof namespace.then);
for (const read of [() => namespace.value, () => namespace["val" + "ue"], () => Object.keys(namespace)]) {
  try {
    console.log(read());
  } catch (error) {
    console.log(error.name);
  }
}
console.log("value" in namespace, Reflect.ownKeys(namespace).map(String).join());
