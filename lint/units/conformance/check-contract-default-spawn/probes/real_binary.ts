// What the probe says about the binary that runs this script (research probe).
import { probe } from "../prototype/check";
const env = { ...process.env, NO_COLOR: "1", BUN_DEBUG_QUIET_LOGS: "1" } as Record<string, string | undefined>;
console.log(process.execPath, Bun.version, Bun.revision);
console.log(JSON.stringify(await probe({ command: [process.execPath], env })));
