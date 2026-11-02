// closed-world/worker-from-text-runs-apart built with --compile-inspector. A debugger can run any code, so such a build runs text too: both Workers run as in plain Bun.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
// Flags: --compile-inspector
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  return message.includes("the compiler couldn't tell at build time") ? "refused: " + message : error.name;
}
function attempt(label, action) {
  try { console.log(label + ": " + action()); } catch (error) { console.log(label + ": " + outcome(error)); }
}
function started(label, url) {
  return new Promise(resolve => {
    try {
      const worker = new Worker(url);
      worker.onmessage = event => resolve(label + ": " + event.data);
      worker.onerror = event => resolve(label + ": " + outcome(event));
    } catch (error) {
      resolve(label + ": " + outcome(error));
    }
  });
}
async function main() {
  const text = decoded("postMessage(1 + 1); close();");
  console.log(await started("a Worker from a blob: URL", URL.createObjectURL(new Blob([text], { type: "text/javascript" }))));
  console.log(await started("a Worker from a data: URL", "data:text/javascript," + encodeURIComponent(text)));
}
main();
