/**
 * Sandboxfile: A declarative spec for agent sandboxes
 *
 * This module provides parsing and execution of Sandboxfile configurations.
 */

export { loadSandboxfile, parseSandboxfile } from "./parser";
export type { SandboxProcess, Sandboxfile } from "./parser";
export { SandboxRunner } from "./runner";
export type { ProcessHandle, RunResult, RunnerOptions } from "./runner";
