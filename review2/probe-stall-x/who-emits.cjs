// Which frame emits each 'data'? argv: <mode: direct|exit|pause>
const { spawn } = require("child_process");
const mode = process.argv[2];
const script = mode === "direct" ? "sleep 0.1; printf 1; sleep 0.1; printf 2" : "for i in 1 2 3; do printf $i; sleep 0.05; done";
const c = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "ignore"] });
const out = [];
process.on("uncaughtException", () => out.push("  -> uncaughtException"));
process.on("unhandledRejection", () => out.push("  -> unhandledRejection"));
function attach() {
  c.stdout.on("data", d => {
    const frames = new Error().stack.split("\n").slice(2).map(l => l.trim().replace(/^at /, "").replace(/ \(.*$/, "").replace(/^(node:|internal).*$/, "?")).filter(f => f && f !== "?" && !/^<anonymous>$/.test(f));
    out.push(`data:${d} via ${frames.slice(0, 9).join(" < ")}`);
    throw new Error("boom");
  });
  c.stdout.on("end", () => out.push("end"));
}
if (mode === "exit") c.on("exit", () => { out.push("exit"); attach(); });
else { attach(); if (mode === "pause") { c.stdout.pause(); setTimeout(() => { out.push("resume()"); c.stdout.resume(); }, 120); } }
c.on("close", code => out.push("close:" + code));
setTimeout(() => { console.log(out.join("\n")); process.exit(0); }, 1200);
