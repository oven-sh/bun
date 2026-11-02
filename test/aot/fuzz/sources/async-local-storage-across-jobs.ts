// Programs of ../async-local-storage-across-jobs.ts, one per seed. That file describes them.
import { generate } from "../async-local-storage-across-jobs";
import { Random } from "../random";
import { endless } from "../family";

export default endless("async local storage across jobs", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
  make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
}));
