// Env of the build: BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1
// Env of the build: BUN_GARBAGE_COLLECTOR_LEVEL=1
// Env: BUN_OPTIONS=--expose-internals
import { membersUnderNamesOfTheRuntime } from "bun:internal-for-testing";

console.log(membersUnderNamesOfTheRuntime(process.argv.length > 9 ? "other" : "tag").join("\n"));
