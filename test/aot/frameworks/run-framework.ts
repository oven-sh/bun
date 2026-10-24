import { expect } from "bun:test";
import { test } from "../supported";
import { bunEnv, bunExe, isASAN, isWindows, nodeExe, tempDir } from "harness";
import { cpSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { run as runCommand } from "../harness/run";

interface Framework {
  build: string[];
  // `ng build` registers a module loader hook, which Bun does not have.
  isBuiltByNode?: boolean;
  binaryFiles?: Record<string, string>;
  copiedAfterTheBuild?: [from: string, to: string][];
  directory: string;
  entryPoint: string;
  moreEntryPoints?: string[];
  assets: string[];
  evaluatesText?: boolean;
}

const frameworks = {
  "next": {
    build: ["node_modules/next/dist/bin/next", "build"],
    isBuiltByNode: isASAN,
    binaryFiles: {
      "public/picture.png":
        "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABEUlEQVR42u3PAUYlAABAwU9RFEVRFEVRFEVRFMXGRlEURVEURVEURdGjaClaiqIoiqIoiqIoiqIoiqIoiqIoiqKoI3SBNzeYQOCb4E9C3wl/JfKZ6Edi74m/JfGa5EtSz0k/JfOY7ENy98nfpXCbok2K1yldpXyZykWq56mdpX6axkmax2kdpX2EziG6B+nthz4GevjXxXAH/9sYa2GiiakGZuqYq2GhiqUKVspYK2HjL1t/2ClgL4+DHI6yOMngLI2LFK6SuEngLo6HGJ6ieIngLYyPEL6CCBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGfgv8AOiR8VoP+egrAAAAAElFTkSuQmCC",
    },
    copiedAfterTheBuild: [
      ["public", ".next/standalone/public"],
      [".next/static", ".next/standalone/.next/static"],
    ],
    directory: ".next/standalone",
    entryPoint: "./server.js",
    moreEntryPoints: [".next/server/**/*.js"],
    assets: [".next", "public", "node_modules/@img"],
    evaluatesText: true,
  },
  "nuxt": { build: ["node_modules/nuxt/bin/nuxt.mjs", "build"], directory: ".", entryPoint: "./.output/server/index.mjs", assets: [".output/public"] },
  "sveltekit": { build: ["node_modules/vite/bin/vite.js", "build"], directory: ".", entryPoint: "./build/index.js", assets: ["build/client", "build/prerendered"] },
  "astro": { build: ["node_modules/astro/bin/astro.mjs", "build"], directory: ".", entryPoint: "./dist/server/entry.mjs", assets: ["dist/client"] },
  "angular": {
    build: ["node_modules/@angular/cli/bin/ng.js", "build"],
    isBuiltByNode: true,
    directory: ".",
    entryPoint: "./dist/site/server/server.mjs",
    moreEntryPoints: ["dist/site/server/{angular,chunk,main,polyfills}*.mjs", "dist/site/server/assets-chunks/*.mjs"],
    assets: ["dist/site/browser", "dist/site/server"],
  },
  "react-router": { build: ["node_modules/@react-router/dev/bin.cjs", "build"], directory: ".", entryPoint: "./server.ts", assets: ["build/client"] },
} satisfies Record<string, Framework>;

const env = {
  ...bunEnv,
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  HOSTNAME: "127.0.0.1",
  NEXT_TELEMETRY_DISABLED: "1",
  NUXT_TELEMETRY_DISABLED: "1",
  ASTRO_TELEMETRY_DISABLED: "1",
  NG_CLI_ANALYTICS: "false",
};

// The frameworks' own build tools have pools of native threads, a thread for each processor, and end a whole pool at once.
// glibc keeps the stacks of ended threads mapped up to this many bytes; its default has room for twenty of them.
const buildToolEnv = { ...env, GLIBC_TUNABLES: "glibc.pthread.stack_cache_size=1073741824" };

async function run(cwd: string, cmd: string[], variables: typeof env = env) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, variables);
  return { output: exitCode === 0 ? "" : stdout + stderr, exitCode };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise(resolve => server.close(resolve));
  return port;
}

const visible = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<link[^>]*>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<template[^>]*><\/template>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();

const keptHeaders = ["content-type", "location", "x-middleware-ran", "x-made-by", "cache-control", "set-cookie", "content-range", "allow"];

async function ask(base: string, requests: string): Promise<string[]> {
  const answers: string[] = [];
  for (const line of requests.split("\n").filter(Boolean)) {
    const [method, written, extra] = line.split(" ") as [string, string, string?];
    if (method === "WAIT") {
      await Bun.sleep(Number(written));
      continue;
    }
    const headers: Record<string, string> = {};
    let body: string | FormData | undefined;
    let path = written;
    if (method === "POST") {
      body = extra;
      headers["content-type"] = "application/json";
    } else if (extra) {
      const colon = extra.indexOf(":");
      headers[extra.slice(0, colon)] = decodeURIComponent(extra.slice(colon + 1));
    }
    if (method === "RSC") headers["rsc"] = "1";
    try {
      if (path.includes("/BUILD/")) {
        path = path.replace("BUILD", /"buildId":"([^"]+)"/.exec(await (await fetch(base + "/legacy")).text())?.[1] ?? "no-build-id");
      }
      if (method === "FORM" || method === "ACTION") {
        body = new FormData();
        headers["origin"] = base;
        body.set("word", "sent in a form");
        if (method === "FORM") body.set("file", new File(["the text of a file"], "note.txt", { type: "text/plain" }));
        else {
          const page = await (await fetch(base + path)).text();
          for (const [, name, value] of page.matchAll(/<input type="hidden" name="(\$ACTION[^"]*)"(?: value="([^"]*)")?/g)) {
            body.set(name!, (value ?? "").replaceAll("&quot;", '"'));
          }
        }
      }
      const sent = method === "RSC" || method === "BYTES" ? "GET" : method === "FORM" || method === "ACTION" ? "POST" : method;
      const response = await fetch(base + path, { method: sent, headers, body, redirect: "manual" });
      const text = method === "BYTES" ? await response.bytes().then(bytes => `${bytes.length} bytes, ${Bun.hash(bytes).toString(16)}`) : await response.text();
      answers.push(`${method} ${written} -> ${response.status} ${keptHeaders.map(name => `${name}=${(response.headers.get(name) ?? "-").replaceAll(base, "<base>")}`).join(" ")}`);
      answers.push(
        method === "RSC"
          ? text
              .split("\n")
              .filter(each => /person|doubled|post |letters/.test(each))
              .join(" ")
              .replace(/"b":"[^"]*"/, '"b":"<build>"')
          : visible(text).replaceAll(base, "<base>"),
      );
      if (method === "ACTION") {
        const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0]!;
        answers.push(visible(await (await fetch(base + path, { headers: { cookie } })).text()));
      }
    } catch (error) {
      answers.push(`${method} ${written} -> ${(error as Error).message.replaceAll(base, "<base>")}`);
    }
  }
  return answers;
}

async function serve(cwd: string, cmd: string[], requests: string, more: Record<string, string> = {}) {
  const port = await freePort();
  await using server = Bun.spawn({ cmd, cwd, env: { ...env, ...more, PORT: String(port), NITRO_PORT: String(port) }, stdout: "pipe", stderr: "pipe" });
  const base = `http://127.0.0.1:${port}`;
  for (;;) {
    try {
      await (await fetch(base + "/", { redirect: "manual" })).arrayBuffer();
      break;
    } catch {
      if (server.exitCode !== null) throw new Error(`the server ended with ${server.exitCode}: ${await server.stdout.text()}${await server.stderr.text()}`);
      await Bun.sleep(5);
    }
  }
  return await ask(base, requests);
}

export function testFramework(name: keyof typeof frameworks, form: "in place" | "one file" = "in place") {
  const framework: Framework = frameworks[name];
  // TODO: on Windows x64 the build of next ends with exit code 9 and says nothing.
  const notYet = name === "next" && isWindows && process.arch === "x64";
  (notYet ? test.todo : test.skipIf(framework.isBuiltByNode === true && !nodeExe()))(
    form === "in place" ? name : `${name}, as one file`,
    async () => {
      using dir = tempDir(`aot-framework-${name}`, {});
      const site = join(String(dir), "site");
      cpSync(join(import.meta.dir, "apps", name), site, { recursive: true });
      const requests = readFileSync(join(import.meta.dir, "requests", `${name}.txt`), "utf8");
      for (const [path, base64] of Object.entries(framework.binaryFiles ?? {})) writeFileSync(join(site, path), Buffer.from(base64, "base64"));

      const installed = process.env.BUN_TEST_AOT_FRAMEWORK_PACKAGES;
      expect(
        installed
          ? await run(site, ["cp", "-R", join(installed, name, "node_modules"), "node_modules"])
          : await run(site, [bunExe(), "install", "--ignore-scripts", "--linker", "hoisted"]),
      ).toEqual({ output: "", exitCode: 0 });

      mkdirSync(join(site, "node_modules", "@types"), { recursive: true });
      symlinkSync(join(import.meta.dir, "..", "..", "..", "packages", "bun-types"), join(site, "node_modules", "@types", "bun"));

      if (name === "sveltekit") expect(await run(site, [bunExe(), "--bun", "node_modules/@sveltejs/kit/svelte-kit.js", "sync"], buildToolEnv)).toEqual({ output: "", exitCode: 0 });
      expect(await run(site, [...(framework.isBuiltByNode ? [nodeExe()!] : [bunExe(), "--bun"]), ...framework.build], buildToolEnv)).toEqual({ output: "", exitCode: 0 });
      for (const [from, to] of framework.copiedAfterTheBuild ?? []) cpSync(join(site, from), join(site, to), { recursive: true });

      const directory = join(site, framework.directory);
      const expected = await serve(directory, [bunExe(), framework.entryPoint], requests);
      expect(expected.join("\n")).not.toContain("Unable to connect");

      const executable = join(String(dir), "executable");
      expect(
        await run(directory, [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          ...(form === "in place" ? ["--compile-in-place"] : []),
          framework.entryPoint,
          ...(framework.moreEntryPoints ?? []),
          ...framework.assets.flatMap(asset => ["--asset", asset]),
          "--outfile",
          executable,
        ]),
      ).toEqual({ output: "", exitCode: 0 });

      renameSync(site, join(String(dir), "moved-away"));
      // Next's server.js calls process.chdir(__dirname).
      mkdirSync(directory, { recursive: true });

      expect(await serve(directory, [executable], requests)).toEqual(expected);
      if (!framework.evaluatesText) expect(await serve(directory, [executable], requests, { BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(expected);
    },
    1_200_000,
  );
}
