// usage: <bun> bun-accepts.mjs   Reads test-rows.txt: for each row, what the parse pass of the running bun (scanImports) does.
// Prints the rows of the groups `parses` and `the-reference-inserts-a-semicolon` that the parse pass rejects, and the rows
// of the other groups that it rejects on its own (no walk is needed for them), with its message.
const lines = (await Bun.file(new URL("./test-rows.txt", import.meta.url)).text()).split("\n");
let group = "";
const counts = {};
for (const line of lines) {
  if (line.startsWith("// ")) { group = line.slice(3); continue; }
  const m = /^\s*\(b"((?:[^"\\]|\\.)*)", Loader::(\w+)(?:, (\d+), (\d+), (\d+), (.*))?\),/.exec(line);
  if (!m) continue;
  const text = Buffer.from(JSON.parse('"' + m[1].replace(/\\x([0-9a-f]{2})/g, (_, h) => "\\u00" + h) + '"'), "latin1").toString("utf8");
  const loader = m[2].toLowerCase();
  let err = null;
  try { new Bun.Transpiler({ loader }).scanImports(text); } catch (e) { const x = (e?.errors ?? [e])[0]; err = `@${x.position?.offset}+${x.position?.length} ${x.message}`; }
  const c = (counts[group] ||= { rows: 0, rejected: 0 });
  c.rows++;
  if (err) { c.rejected++; console.log(`${group}\t${JSON.stringify(text)} [${loader}]\t${m[3] ? `ref TS${m[3]}@${m[4]}..${m[5]}` : "ref parses"}\tbun ${err}`); }
}
console.log(JSON.stringify(counts));
