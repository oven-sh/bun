import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";

const files = {
  "main.mjs": `
    import http from "node:http";
    import { EventEmitter } from "node:events";
    const message = new http.OutgoingMessage();
    const response = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 });
    const texts = object => Object.getOwnPropertySymbols(object).map(String).join();
    console.log(texts(message));
    console.log(texts(response));
    console.log(texts(new EventEmitter()));
    console.log(new Set(Object.getOwnPropertySymbols(response)).size, response.socket === response.socket, response.chunkedEncoding, response.shouldKeepAlive);
    response.setHeader("Content-Type", "text/plain");
    console.log(response.getHeader("content-type"), response.hasHeader("Content-Type"), response.headersSent, JSON.stringify(response.getHeaders()));
  `,
};

function operationsOf(map: string, name: string, module: string) {
  const lines = map.split("\n");
  const found: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const fields = lines[i].split("\t");
    if (fields[0] !== "F" || fields[7] !== name || fields[10] !== module) continue;
    const operations = lines.slice(i + 1, i + 4).find(line => line.startsWith("O\t"));
    if (operations) found.push(operations.split("\t").filter(field => /^[A-Z][A-Za-z]+$/.test(field)));
  }
  return found;
}

test.skipIf(!!unsupported)(
  "a symbol that one of Bun's own modules keeps in a constant is a name wherever the constant stands in the file",
  async () => {
    using dir = tempDir("aot-symbols-of-builtin-modules", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const mapPath = join(String(dir), "main.map");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
      String(dir),
      { ...bunEnv, BUN_JSC_aotMapFilePath: mapPath },
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const plain = await run([bunExe(), "run", "main.mjs"], String(dir), bunEnv);
    const compiled = await run([executable], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    expect(plain.stdout).toContain("Symbol(kSocket)");
    const map = readFileSync(mapPath, "utf8");
    for (const [name, module] of [
      ["onSocketTimeoutTimerExpired", "node:_http_server"],
      ["OutgoingMessage", "node:_http_outgoing"],
      ["EventEmitter", "node:events"],
    ]) {
      const bodies = operationsOf(map, name, module);
      expect({ name, bodies: bodies.length > 0 }).toEqual({ name, bodies: true });
      expect({
        name,
        byKey: bodies.flat().filter(operation => operation === "GetByVal" || operation === "PutByVal"),
      }).toEqual({ name, byKey: [] });
    }
  },
  240_000,
);
