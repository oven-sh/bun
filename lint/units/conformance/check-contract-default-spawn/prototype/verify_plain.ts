// Verifies the stderr grammar and the position conversion against every oracle baseline (research probe).
import { existsSync, readFileSync } from "node:fs";
import { computeLineStartsUtf16, parsePlainDiagnostics, utf16OffsetOfLineAndColumn, utf8OffsetOfUtf16Offset, writePlainDiagnostic } from "./plain_format";
const P = new URL("../../enumerator/prototype/", import.meta.url).pathname;
const E = new URL("../../error-baseline-format/top-down/", import.meta.url).pathname;
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { makeUnitsFromTest, srcFolder } = await import(P + "test_case_parser.ts");
const { getNormalizedAbsolutePath } = await import(P + "tspath.ts");
const { readFile } = await import(P + "vfs.ts");
const { tsgoRules } = await import(E + "diagnosticwriter.ts");
const { removeTestPathPrefixes } = await import(E + "error_baseline.ts");
const { readErrorBaseline, ReadError } = await import(E + "reader.ts");

const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const baselines = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const requireStr = "require(";
const referencesRegex = /reference[\t\n\f\r ]path/;
const libPrefix = /(?<![^\n])([lL][iI][bB][^\n]*\.[dD]\.[tT](?:[sS]|\xc5\xbf))\(\d+,\d+\)/g;

const e = enumerateInstances({ casesRoot });
let plain = 0, pretty = 0, sectionSame = 0, diagnostics = 0, located = 0, positionsChecked = 0, positionsSame = 0, masked = 0, noUnit = 0, readerFailed = 0, orderSame = 0, withUnits = 0;
const bad: string[] = [];
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const oracle = baselines + "/" + i.suite + "/" + i.name.replace(/\.tsx?$/, ".errors.txt");
  if (!existsSync(oracle)) continue;
  const bytes = readFileSync(oracle);
  const text = bytes.toString("latin1");
  if (text.startsWith("\x1b[")) { pretty++; continue; }
  plain++;
  const end = text.indexOf("\r\n\r\n\r\n");
  const top = text.slice(0, end + 2);
  // what a command line would print: LF, numbers in the place of the mask
  const stderr = Buffer.from(top.replaceAll("\r\n", "\n").replaceAll("(--,--)", "(1,1)"), "latin1").toString("utf8");
  const parsed = parsePlainDiagnostics(stderr);
  if (!parsed.ok) { bad.push(`${i.name}: parse: line ${parsed.stderrLine}: ${parsed.reason}: ${parsed.text.slice(0, 100)}`); continue; }
  diagnostics += parsed.diagnostics.length;
  let out = "";
  for (const d of parsed.diagnostics) out += writePlainDiagnostic(d, d.path, "\r\n");
  out = Buffer.from(out, "utf8").toString("latin1");
  out = removeTestPathPrefixes(tsgoRules, out).replace(libPrefix, "$1(--,--)");
  if (out === top) sectionSame++; else bad.push(`${i.name}: section differs`);

  // positions: the reader gives pos from the squiggles, the conversion gives pos from line and column
  const file = casesRoot + "/" + i.casePath;
  const made = makeUnitsFromTest(readFile(file).contents, file);
  if (!made.ok) continue;
  const t = made.value;
  const config: Map<string, string> | undefined = i.config;
  const currentDirectory = getNormalizedAbsolutePath(config?.get("currentdirectory") ?? "", srcFolder);
  const all = t.tsConfigFileUnitData !== undefined ? [t.tsConfigFileUnitData, ...t.testUnitData] : t.testUnitData;
  const byDisplay = new Map<string, string>();
  for (const u of all) byDisplay.set(removeTestPathPrefixes(tsgoRules, getNormalizedAbsolutePath(u.name, currentDirectory)), u.content);
  let read;
  try {
    read = readErrorBaseline(tsgoRules, text, {});
  } catch (err) {
    if (err instanceof ReadError) { readerFailed++; continue; }
    throw err;
  }
  withUnits++;
  const fromReader = read.diagnostics as any[];
  if (fromReader.length !== parsed.diagnostics.length) { bad.push(`${i.name}: reader has ${fromReader.length} diagnostics, the section ${parsed.diagnostics.length}`); continue; }
  let same = true;
  for (let k = 0; k < fromReader.length; k++) {
    const r = fromReader[k];
    const d = parsed.diagnostics[k];
    if (d.path === undefined) { if (r.file !== undefined) same = false; continue; }
    located++;
    if (r.file === undefined || r.code !== d.code) { same = false; continue; }
    if (top.includes(d.path + "(--,--)") && /^lib\..*\.d\.ts$/.test(d.path)) { masked++; continue; }
    const content = byDisplay.get(d.path);
    if (content === undefined) { noUnit++; continue; }
    const starts = computeLineStartsUtf16(content);
    const u16 = utf16OffsetOfLineAndColumn(content, starts, d.line, d.column);
    const u8 = u16 === undefined ? undefined : utf8OffsetOfUtf16Offset(content, u16);
    positionsChecked++;
    if (u8 === r.pos) positionsSame++;
    else if (bad.length < 60) bad.push(`${i.name}: ${d.path}(${d.line},${d.column}) converts to ${u8}, the reader has ${r.pos}`);
  }
  if (same) orderSame++;
}
console.log(JSON.stringify({ plain, pretty, sectionSame, diagnostics, located, masked, noUnit, positionsChecked, positionsSame, readerFailed, withUnits, orderSame }, null, 1));
console.log(bad.slice(0, 40).join("\n"));
