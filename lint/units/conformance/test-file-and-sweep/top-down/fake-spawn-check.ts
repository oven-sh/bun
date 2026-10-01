// Research probe: a check module for --check that spawns the command that stands for a linter.
import { createSpawnCheck } from "./index";
const fake = new URL("../../check-contract-default-spawn/top-down/fakes/lints.ts", import.meta.url).pathname;
export default () => createSpawnCheck({ command: [process.execPath, fake], env: process.env });
