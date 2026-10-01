// Research probe: both ports of the list reader against the reference function (groundtruth/list) on synthetic files and on the two lists.
import { readFileSync } from "node:fs";
import { parseFileNameSet } from "./baseline";
import { parseFileNameSetBytes } from "./baseline_bytes";
const V = import.meta.dir + "/../vectors/";
const expected = JSON.parse(readFileSync(V + "list-expected.json", "utf8")) as Record<string, string[] | number>;
let files = 0, text = 0, bytes = 0;
for (const [name, want] of Object.entries(expected)) {
  if (!Array.isArray(want)) continue;
  const path = name === "submoduleTriaged.txt" ? "/workspace/ref/typescript-go/testdata/submoduleTriaged.txt" : V + "list-inputs/" + name;
  const raw = readFileSync(path);
  files++;
  const wanted = JSON.stringify([...want].sort());
  const b = JSON.stringify([...parseFileNameSetBytes(raw)].sort());
  const t = JSON.stringify([...parseFileNameSet(raw.toString("utf8"))].map(k => Buffer.from(k, "utf8").toString("latin1")).sort());
  if (b !== wanted) { bytes++; console.log("the port on bytes differs:", name, b, "want", wanted); }
  if (t !== wanted) { text++; console.log("the port on text differs:", name, t, "want", wanted); }
}
const accepted = readFileSync("/workspace/ref/typescript-go/testdata/submoduleAccepted.txt");
console.log("accepted entries: on bytes", parseFileNameSetBytes(accepted).size, "on text", parseFileNameSet(accepted.toString("utf8")).size, "reference", expected["submoduleAccepted.txt (count)"]);
console.log("files", files, "differences of the port on bytes", bytes, "of the port on text", text);
