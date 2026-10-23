import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  // A new dictionary each round, filled under computed keys and walked: what a server does with the headers of a response.
  "walk.js": `
    const rounds = Number(process.argv[2]);
    const names = ["Content-Type", "Content-Length", "ETag", "X-Powered-By"];
    function store(headers, name, value) {
      headers[name.toLowerCase()] = [name, value];
    }
    function render(headers) {
      let text = "";
      for (const key in headers) {
        const entry = headers[key];
        text += entry[0] + ": " + entry[1] + "\\n";
      }
      return text;
    }
    let last = "";
    for (let round = 0; round < rounds; round++) {
      const headers = round & 1 ? {} : { __proto__: null };
      for (let i = 0; i < names.length; i++) store(headers, names[i], i);
      last = render(headers);
    }
    console.log(last);
    const changing = { __proto__: null };
    for (let i = 0; i < names.length; i++) store(changing, names[i], i);
    const seen = [];
    for (const key in changing) {
      seen.push(key);
      delete changing.etag;
      changing.added = [key, 0];
    }
    console.log(seen.join());
  `,
  // The key is a new string each time, so no stub can tell its name.
  "read.js": `
    const rounds = Number(process.argv[2]);
    const unseen = new Function("x", "return x");
    function Parameters() {}
    Parameters.prototype = Object.create(null);
    Parameters.prototype.inherited = "above";
    function read(parameters, key) {
      return parameters[key];
    }
    let count = 0;
    for (let round = 0; round < rounds; round++) {
      const parameters = unseen(new Parameters());
      const header = unseen("text/html; charset=utf-" + (round & 7) + "; inherited=1");
      if (read(parameters, header.slice(11, 18)) === undefined) count++;
      if (read(parameters, header.slice(26, 35)) === "above") count++;
    }
    console.log(count === 2 * rounds);
    const header = unseen("text/html; charset=utf-8; inherited=1");
    Parameters.prototype.charset = "now above";
    Parameters.prototype.inherited = "changed";
    console.log(read(unseen(new Parameters()), header.slice(11, 18)), read(unseen(new Parameters()), header.slice(26, 35)));
    delete Parameters.prototype.inherited;
    console.log(read(unseen(new Parameters()), header.slice(26, 35)), header.slice(26, 35) in unseen(new Parameters()), header.slice(11, 18) in unseen(new Parameters()));
  `,
};

async function countOperations(program: string, output: string, operations: string[]) {
  using dir = tempDir("aot-dictionaries-avoid-runtime", files);
  const executable = join(String(dir), program + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", program + ".js", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counted = async (rounds: number) => {
    const path = join(String(dir), "counts" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
      stdout: output,
      stderr: "",
      exitCode: 0,
    });
    let sum = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && operations.includes(name)) sum += Number(count);
    }
    return sum;
  };
  return { few: await counted(400), many: await counted(4400) };
}

// Each collection drops what was found, so a few calls come back with the length of the run.
const callsAfterCollections = 200;

test("a walk over dictionaries with the same keys stops asking the run time", async () => {
  const output =
    "Content-Type: 0\nContent-Length: 1\nETag: 2\nX-Powered-By: 3\n\ncontent-type,content-length,x-powered-by\n";
  const { few, many } = await countOperations("walk", output, [
    "operationAOTGetPropertyEnumerator",
    "operationAOTEnumeratorNext",
  ]);
  expect(many - few).toBeLessThan(callsAfterCollections);
}, 240_000);

test("a read under a key that is a new string each time files its answer once", async () => {
  const output = "true\nnow above changed\nundefined false true\n";
  const { few, many } = await countOperations("read", output, ["operationAOTGetByValAndCache", "operationAOTGetByVal"]);
  expect(many - few).toBeLessThan(callsAfterCollections);
}, 240_000);
