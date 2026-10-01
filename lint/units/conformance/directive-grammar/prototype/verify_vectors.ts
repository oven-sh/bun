// Runs the port on recorded inputs and writes results in the shape of the Go oracle's output.
import { getConfigNameFromFileName } from "./harnessutil";
import { skipTrivia } from "./scanner";
import { extractCompilerSettings, parseTestFilesAndSymlinksWithOptions } from "./test_case_parser";
import { decodeBytes } from "./vfs";
const inputs: any[] = JSON.parse(await Bun.file(process.argv[2]).text());
const obj = (m: Map<string, string>) => Object.fromEntries([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
const outs: any[] = [];
for (const i of inputs) {
  const raw = Buffer.from(i.bytes, "base64");
  const d = raw.length === 0 ? { ok: true as const, value: "" } : decodeBytes(raw);
  if (!d.ok) {
    outs.push({ name: i.name, refused: d.reason });
    continue;
  }
  const content = d.value;
  const bytes = new TextEncoder().encode(content);
  const o: any = { name: i.name, decoded: content, lines: content.split(/\r?\n/), settings: obj(extractCompilerSettings(content)), panic: "", units: [], configUnit: null, symlinks: {}, currentDirectory: "", globalOptions: {}, skipTrivia: skipTrivia(bytes, 0), error: "", decodedByteLen: bytes.length };
  const failOn = i.failOn ?? "";
  const r = parseTestFilesAndSymlinksWithOptions(content, i.fileName, (name, content, fileOptions) =>
    failOn !== "" && name === failOn
      ? { value: { name: "FAILED:" + name, content, fileOptions: obj(fileOptions) }, error: "cannot parse " + name }
      : { value: { name, content, fileOptions: obj(fileOptions) }, error: undefined }, { allowImplicitFirstFile: !!i.allowImplicitFirstFile });
  if (!r.ok) o.panic = r.reason;
  else {
    let units = r.value.units;
    o.error = r.value.error ?? "";
    o.symlinks = obj(r.value.symlinks); o.currentDirectory = r.value.currentDirectory; o.globalOptions = obj(r.value.globalOptions);
    if (!i.allowImplicitFirstFile) {
      const k = units.findIndex(u => getConfigNameFromFileName(u.name) !== "");
      if (k >= 0) { o.configUnit = units[k]; units = units.filter((_, x) => x !== k); }
    }
    o.units = units;
  }
  outs.push(o);
}
await Bun.write(process.argv[3], JSON.stringify(outs));
