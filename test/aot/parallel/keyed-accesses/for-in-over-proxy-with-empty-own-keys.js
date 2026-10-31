// for-in over a Proxy calls the handler's ownKeys trap. Flow analysis must reach a fixpoint: rerunning every rule adds nothing.
// Flags: --aot-check=flow-fixpoint
function lastKey(object) {
  let result = "none";
  for (const key in object) result = key;
  return result;
}
console.log(lastKey(new Proxy({}, { ownKeys() { console.log("ownKeys"); return []; } })));
