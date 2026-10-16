// One server that is a registry under every first path segment: <origin>/<PREFIX>/<pkg>.
// The bin of a package prints SERVED-BY-<PREFIX>. Requests are logged to /tmp/probe/requests.log.
import { appendFileSync, writeFileSync } from "node:fs";
import { githubTarball } from "/workspace/bun/test/harness.ts";

writeFileSync("/tmp/probe/requests.log", "");
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const [prefix, ...rest] = decodeURIComponent(new URL(req.url).pathname).split("/").filter(Boolean);
    appendFileSync("/tmp/probe/requests.log", `${prefix} ${req.headers.get("authorization")} ${rest.join("/")}\n`);
    const isTarball = rest.at(-1) === "pkg.tgz";
    const pkg = (isTarball ? rest.slice(0, -1) : rest).join("/");
    const bin = pkg.slice(pkg.lastIndexOf("/") + 1);
    const packageJson = { name: pkg, version: "1.0.0", bin: { [bin]: "cli.js" } };
    if (isTarball) {
      return new Response(
        await githubTarball("package", {
          "package.json": JSON.stringify(packageJson),
          "cli.js": `#!/usr/bin/env node\nconsole.log("SERVED-BY-${prefix}");\n`,
        }),
      );
    }
    return Response.json({
      name: pkg,
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { ...packageJson, dist: { tarball: `${origin}/${prefix}/${pkg}/pkg.tgz` } } },
      time: { "1.0.0": new Date(0).toISOString() },
    });
  },
});
const origin = `http://127.0.0.1:${server.port}`;
writeFileSync("/tmp/probe/port", String(server.port));
console.log("listening", server.port);
