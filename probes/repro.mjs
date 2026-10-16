// child.stdin.write(chunk, callback): the callbacks must fire in the order of the writes. exit 0 = in order, 1 = out of order
import { spawn } from "node:child_process";
if (process.argv[2] === "kid") { process.stdin.resume(); process.stdin.on("end", () => process.exit(0)); }
else {
  const rest = [import.meta.filename, "kid"];
  const kid = spawn(process.execPath, process.versions.bun ? ["--no-install", ...rest] : rest, { stdio: ["pipe", "ignore", "inherit"] });
  const order = [];
  kid.stdin.write(Buffer.alloc((1 << 20) + 1), () => order.push(1));
  kid.stdin.write("", () => order.push(2));
  kid.stdin.write("x", () => order.push(3));
  kid.stdin.end(() => { console.log("callbacks fired in the order", order.join(",")); process.exit(order.join() === "1,2,3" ? 0 : 1); });
}
