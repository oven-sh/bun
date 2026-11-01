// The cases of ../operand-dependent-throws.ts that can stand at the top level of a module, where initialization may be
// deferred until first use: sixteen modules per program, loaded one after the other; each prints its log and how it
// finished.
import { endless } from "../family";
import { everyModuleScene, writeModules, type ModuleScene } from "../operand-dependent-throws";
import { Random } from "../random";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    strict: true,
    types: [],
  },
});
let scenes: ModuleScene[] | undefined;

export default endless("throwing ops at top level", index => ({
  name: `seed ${index + 1}.`,
  make: () => {
    const random = new Random(index + 1);
    scenes ??= everyModuleScene();
    const { "main.ts": text, ...files } = writeModules(
      Array.from({ length: 16 }, () => random.pick(scenes!)),
      "main",
    );
    return { file: "main.ts", text, files: { "tsconfig.json": tsconfig, ...files } };
  },
}));
