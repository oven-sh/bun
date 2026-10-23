import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";

const files = {
  "main.cjs": `
    const outgoing = require("node:_http_outgoing");
    const incoming = require("node:_http_incoming");
    const common = require("node:_http_common");
    const http = require("node:http");
    const events = require("node:events");
    const names = object => Object.keys(object).filter(name => typeof object[name] === "symbol").sort().map(name => name + " " + String(object[name])).join();
    console.log(names(outgoing));
    console.log(names(incoming));
    console.log(names(common));
    const message = new http.OutgoingMessage({ highWaterMark: 7, rejectNonStandardBodyWrites: true });
    console.log(message[outgoing.kHighWaterMark], message[outgoing.kRejectNonStandardBodyWrites], message[outgoing.kSocket], message[outgoing.kErrored], message.writableHighWaterMark);
    const server = http.createServer({ uniqueHeaders: ["x-one"], highWaterMark: 9 });
    console.log([...server[outgoing.kUniqueHeaders]].join(), server[outgoing.kHighWaterMark], typeof server[common.kIncomingMessage]);
    console.log(events.errorMonitor === Symbol.for("events.errorMonitor"), events.captureRejectionSymbol === Symbol.for("nodejs.rejection"));
    const { Readable } = require("node:stream");
    const readable = new Readable({ read() {} });
    console.log(Readable.isDisturbed(readable), Readable.isErrored(readable), require("node:stream").isReadable(readable), require("node:stream").isDestroyed(readable));
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
  "the symbols that node:_http_server takes from the other http modules are names",
  async () => {
    using dir = tempDir("aot-symbols-shared-by-http-modules", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const mapPath = join(String(dir), "main.map");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
      String(dir),
      { ...bunEnv, BUN_JSC_aotMapFilePath: mapPath },
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const plain = await run([bunExe(), "run", "main.cjs"], String(dir), bunEnv);
    const compiled = await run([executable], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    expect(plain.stdout).toContain("kSocket Symbol(kSocket)");
    const map = readFileSync(mapPath, "utf8");
    for (const [name, module] of [
      ["ServerResponse", "node:_http_server"],
      ["parserOnIncomingClient", "node:_http_client"],
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
