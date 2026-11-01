// Programs of ../export-equals-import-forms.ts, one per seed. That file describes them.
import { generate } from "../export-equals-import-forms";
import { Random } from "../random";
import { endless } from "../family";

export default endless("export equals import forms", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.ts", ...generate(new Random(index + 1)) }),
}));
