import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
test("an expect() that fails inside a child.stdout 'data' listener", async () => {
  const child = spawn(process.execPath, ["-e", "const b=Buffer.alloc(65536,120); let i=0; (function w(){ while(i<32){ i++; if(!process.stdout.write(b)) return process.stdout.once('drain', w);} })()"]);
  let calls = 0;
  child.stdout.on("data", d => { calls++; expect(d.length).toBe(-1); });
  const code = await new Promise(resolve => child.on("close", resolve));
  console.log("close", code, "calls", calls);
}, 3000);
test("the next test still runs", () => { expect(1).toBe(1); });
