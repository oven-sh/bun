import { membersUnderNamesOfTheRuntime } from "bun:internal-for-testing";

console.log(membersUnderNamesOfTheRuntime(process.argv.length > 9 ? "other" : "tag").join("\n"));
