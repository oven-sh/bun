// The compiler finds nothing in this program that evaluates text, and counts on it. A Worker whose script is text that the program makes at run time runs apart from the program, as in plain Bun. closed-world/worker-from-text-admitted is the same program built with --compile-inspector.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  return message.includes("this executable, which only runs code that was compiled into it") ? "refused: it isn't in this executable" : error.name;
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
