// Native bindings of the library: readFileCb, writeFileCb and appendFileCb answer undefined, or the error of a signal that was aborted before the call, and then node:fs calls the program's callback before it returns. Code that takes the answer for undefined alone never calls it.
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFile, mkdtempSync, readFile, readFileSync, rmSync, writeFile } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = mkdtempSync(join(tmpdir(), "aot-fs-signal-"));
const file = join(folder, "file.txt");
const storage = new AsyncLocalStorage<string>();
const log: string[] = [];

function heard(name: string): (err: Error | null, data?: unknown) => void {
  return (err, data) => {
    log.push(`${name}: ${err === null ? "null" : err.name} ${typeof data} in ${storage.getStore()}`);
  };
}

const aborted = { signal: AbortSignal.abort() };
const live = { signal: new AbortController().signal };

storage.run("the caller", () => {
  writeFile(file, "never written", aborted, heard("writeFile, aborted"));
  log.push("writeFile returned");
  appendFile(file, "never written", aborted as any, heard("appendFile, aborted"));
  log.push("appendFile returned");
  readFile(file, aborted, heard("readFile, aborted"));
  log.push("readFile returned");

  try {
    readFile(file, aborted, () => {
      throw new Error("thrown by the callback");
    });
    log.push("nothing was thrown");
  } catch (error) {
    log.push(`the caller caught: ${(error as Error).message}`);
  }

  writeFile(file, "written", live, err => {
    heard("writeFile")(err);
    appendFile(file, " twice", err => {
      heard("appendFile")(err);
      readFile(file, "utf8", (err, data) => {
        heard("readFile")(err, data);
        log.push(`the file holds: ${readFileSync(file, "utf8")}`);
        rmSync(folder, { recursive: true, force: true });
        console.log(log.join("\n"));
      });
    });
  });
  log.push("writeFile with a live signal returned");
});
