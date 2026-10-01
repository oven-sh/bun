// Stand-in for a command that does not know --lint: it runs its first operand.
import { resolve } from "node:path";
const operands = process.argv.slice(2).filter(a => !a.startsWith("--"));
await import(resolve(operands[0]));
