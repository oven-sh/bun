// Env of the build: BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1
import { membersUnderNamesOfTheRuntime } from "bun:internal-for-testing";

console.log(membersUnderNamesOfTheRuntime(process.argv.length > 9 ? "other" : "tag").join("\n"));
