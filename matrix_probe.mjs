// Matrix probe: registry source x spelling x command. Loopback stubs only.
// Usage: bun matrix_probe.mjs <bun-exe> [sources] [commands]
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exe = process.argv[2] || "bun";
const sources = (process.argv[3] || "bunfig,npmrc,env,cli").split(",");
const onlyCommands = process.argv[4] ? process.argv[4].split(",") : null;
const verbose = process.env.VERBOSE === "1";

const seen = [];
function stub(tag, port = 0) {
  try {
    return Bun.serve({
      port,
      hostname: "127.0.0.1",
      async fetch(req) {
        const m = /^[a-z]+:\/\/[^/]*(\/[^?#]*)/i.exec(req.url);
        seen.push(`${tag}:${req.method} ${m ? m[1] : req.url} auth=${req.headers.get("authorization")}`);
        return Response.json({ error: "stub" }, { status: 404 });
      },
    });
  } catch (e) {
    console.log(`(could not bind ${tag} on port ${port}: ${e.message})`);
    return null;
  }
}
const A = stub("A");
const P80 = stub("PORT80", 80);
const P = A.port;

const spellings = {
  "http": { value: `http://127.0.0.1:${P}/`, valid: true },
  "HTTP": { value: `HTTP://127.0.0.1:${P}/`, valid: true },
  "Http-noslash": { value: `Http://127.0.0.1:${P}`, valid: true },
  "http-path": { value: `http://127.0.0.1:${P}/npm/`, valid: true },
  "htp": { value: `htp://127.0.0.1:${P}/`, valid: false },
  "htps": { value: `htps://127.0.0.1:${P}/`, valid: false },
  "ws": { value: `ws://127.0.0.1:${P}/`, valid: false },
  "host:port": { value: `127.0.0.1:${P}/`, valid: false },
  "name:port": { value: `localhost:${P}/`, valid: false },
  "host:port+pathtoken": { value: `127.0.0.1:${P}/:_authToken=URL-TOKEN`, valid: false },
  "//host:port": { value: `//127.0.0.1:${P}/`, valid: false },
  "//userinfo@host:port": { value: `//user:S3CRETPW@127.0.0.1:${P}/`, valid: false },
  "userinfo@host:port": { value: `user:S3CRETPW@127.0.0.1:${P}/`, valid: false },
  "http+badport": { value: `http://127.0.0.1:demo/`, valid: false },
  "http+userinfo+badport": { value: `http://user:S3CRETPW@127.0.0.1:demo/`, valid: false },
  "http+v6-unbracketed": { value: `http://::1:${P}/`, valid: false },
  "notaurl": { value: `asdfghjkl`, valid: false },
};

const commands = {
  install: { args: ["install"], sends: true },
  publish: { args: ["publish"], sends: true },
  "publish-dry": { args: ["publish", "--dry-run"], sends: false },
  "publish-tolerate-dry": { args: ["publish", "--dry-run", "--tolerate-republish"], sends: true },
  whoami: { args: ["pm", "whoami"], sends: true },
  view: { args: ["pm", "view", "no-deps-zz"], sends: true },
  audit: { args: ["audit"], sends: true, lock: true },
  diff: { args: ["pm", "diff", "no-deps-zz@1.0.0", "no-deps-zz@2.0.0"], sends: true },
  "pm-bin": { args: ["pm", "bin"], sends: false },
  "pm-ls": { args: ["pm", "ls"], sends: false, lock: true },
};

const summary = { junkCells: 0, junkCellsWithRequests: 0, junkRequests: 0, validSendCells: 0, validSendCellsReached: 0, secretCells: 0, rows: [] };

for (const source of sources) {
  for (const [spelling, { value, valid }] of Object.entries(spellings)) {
    for (const [label, cmd] of Object.entries(commands)) {
      if (onlyCommands && !onlyCommands.includes(label)) continue;
      seen.length = 0;
      const dir = mkdtempSync(join(tmpdir(), "mx-"));
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "clr-pkg-zz", version: "1.0.0", dependencies: { "no-deps-zz": "1.0.0" } }),
      );
      const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_PROXY: "*" };
      for (const k of Object.keys(env)) {
        if (/^(bun_config_|npm_config_|http_proxy$|https_proxy$)/i.test(k)) delete env[k];
      }
      env.BUN_CONFIG_TOKEN = "SECRET-TOKEN";
      env.BUN_INSTALL_CACHE_DIR = join(dir, ".cache");
      let args = [...cmd.args];
      let bunfig = `[install]\ncache = false\n`;
      if (source === "bunfig") bunfig += `registry = ${JSON.stringify(value)}\n`;
      else if (source === "npmrc") writeFileSync(join(dir, ".npmrc"), `registry=${value}\n`);
      else if (source === "env") env.BUN_CONFIG_REGISTRY = value;
      else if (source === "cli") args.push(`--registry=${value}`);
      writeFileSync(join(dir, "bunfig.toml"), bunfig);
      if (cmd.lock) {
        writeFileSync(
          join(dir, "bun.lock"),
          JSON.stringify({
            lockfileVersion: 1,
            workspaces: { "": { name: "clr-pkg-zz", dependencies: { "no-deps-zz": "1.0.0" } } },
            packages: { "no-deps-zz": ["no-deps-zz@1.0.0", "", {}, "sha512-AAAA"] },
          }),
        );
      }
      const proc = Bun.spawn({ cmd: [exe, ...args], cwd: dir, env, stdout: "pipe", stderr: "pipe", timeout: 300000 });
      const [out, errText, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const all = errText + out;
      const err = all
        .split("\n")
        .filter(l => /error|must be|warn|Received|Registry:/i.test(l))
        .slice(0, 2)
        .join(" ~ ")
        .replaceAll(String(P), "<P>")
        .slice(0, 170);
      const leaked = all.includes("S3CRETPW");
      summary.rows.push({ source, spelling, label, exitCode, requests: seen.length, leaked });
      if (!valid) {
        summary.junkCells++;
        if (seen.length) {
          summary.junkCellsWithRequests++;
          summary.junkRequests += seen.length;
        }
      } else if (cmd.sends) {
        summary.validSendCells++;
        if (seen.some(s => s.startsWith("A:"))) summary.validSendCellsReached++;
      }
      if (leaked) summary.secretCells++;
      if (verbose || (!valid && seen.length) || (valid && cmd.sends && !seen.length) || leaked) {
        console.log(
          `${source}`.padEnd(7),
          spelling.padEnd(22),
          label.padEnd(21),
          `exit=${exitCode}`.padEnd(8),
          JSON.stringify(seen).slice(0, 150),
          leaked ? "LEAKED-SECRET" : "",
          "|",
          err,
        );
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
A.stop(true);
P80?.stop(true);
const { rows, ...counts } = summary;
console.log("\nSUMMARY", JSON.stringify(counts));
if (process.env.DUMP) writeFileSync(process.env.DUMP, JSON.stringify(rows));
