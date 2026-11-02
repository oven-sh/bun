// COUNT: hashed:NativeTexts <= 400
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "options-by-name-"));
const file = join(directory, "text.txt");
writeFileSync(file, "héllo", { encoding: "utf8", mode: 0o600 });

const log = [];
let length = 0;
let missing = 0;
let codes = "";
for (let i = 0; i < 3000; i++) {
    length += readFileSync(file, { encoding: i & 1 ? "utf8" : "latin1", flag: "r" }).length;
    if (!statSync(file + ".missing", { throwIfNoEntry: false }))
        missing++;
    try {
        statSync(file + ".missing", { bigint: true });
    } catch (error) {
        if (i < 2)
            codes += [error.code, error.syscall, error.errno < 0, Object.keys(error).join()].join(" ") + ";";
    }
}
log.push(length, missing, codes);

class Options {
    encoding = "utf8";
    get withFileTypes() { return true; }
}
log.push(readdirSync(directory, new Options()).map(entry => [entry.name, entry.isFile()].join()).join());
log.push(readFileSync(file, Object.create({ encoding: "hex" })).length);
log.push(readFileSync(file, { ["enc" + "oding"]: "base64" }));
log.push(typeof statSync(file, { bigint: true }).size, typeof statSync(file, { bigint: false }).size);
const response = new Response("body", { status: 201, statusText: "made", headers: { "x-one": "1" } });
log.push(response.status, response.statusText, response.headers.get("x-one"));
rmSync(directory, { recursive: true, force: true });
console.log(log.join("\n"));
