// Where the time of a full enumeration goes (research probe).
import { enumerateFiles, enumerateInstances, getCompilerFileBasedTest, getStatus } from "./compiler_runner";
import { readFile } from "./vfs";
import { readFileSync } from "node:fs";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const now = () => performance.now();
for (let round = 0; round < 3; round++) {
  let t = now();
  const files = [...enumerateFiles(root + "/compiler", true), ...enumerateFiles(root + "/conformance", true)];
  const tList = now() - t;
  t = now();
  const raw = files.map(f => readFileSync(f));
  const tRead = now() - t;
  t = now();
  const texts = files.map(f => readFile(f).contents);
  const tDecode = now() - t;
  t = now();
  const tests = texts.map(x => getCompilerFileBasedTest(x));
  const tConfig = now() - t;
  t = now();
  let n = 0;
  for (let k = 0; k < files.length; k++) {
    const cfgs = tests[k].configurations.length > 0 ? tests[k].configurations : [undefined];
    for (const c of cfgs) { getStatus(texts[k], files[k], c?.config); n++; }
  }
  const tStatus = now() - t;
  t = now();
  const e = enumerateInstances({ casesRoot: root });
  const tAll = now() - t;
  t = now();
  const one = enumerateInstances({ casesRoot: root, only: "conformance/types/tuple" });
  const tOne = now() - t;
  console.log(`round ${round}: list ${tList.toFixed(0)} ms, raw read ${tRead.toFixed(0)}, read+decode ${tDecode.toFixed(0)}, settings+configurations ${tConfig.toFixed(0)}, status of ${n} ${tStatus.toFixed(0)}, enumerateInstances ${tAll.toFixed(0)} (${e.instances.length}), one directory ${tOne.toFixed(1)} (${one.instances.length} instances of ${one.files} files)`);
}
