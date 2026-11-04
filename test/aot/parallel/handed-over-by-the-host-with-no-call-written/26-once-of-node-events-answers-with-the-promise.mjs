import { once } from "node:events";
async function load(fails) { if (fails) throw new Error("no"); return { name: "a" }; }
function nameOf(loaded) { return typeof loaded + " " + String(loaded.name); }
const sleep = () => new Promise(resolve => setTimeout(resolve, 0));
const change = promise => { promise.constructor = function Other() {}; promise.then = resolve => resolve(7); };
async function main() {
  console.log(nameOf(await load(false)));
  const heard = once(process, "unhandledRejection");
  const kept = load(true);
  const [reason, promise] = await heard;
  change(promise);
  console.log(reason.message, promise === kept, nameOf(await kept));
}
main();
