// `import()` takes a name or "node:os", and the name's `--define` value is a member below `env` that the file imports from "node:process". No build follows the environment: the executable loads "node:os".
// Flags: --define NAME=env.MODULE_NAME
import { env } from "node:process";
const mod = await import(NAME ?? "node:os");
console.log(typeof mod.platform);
