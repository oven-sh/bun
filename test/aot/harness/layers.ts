import { expect } from "bun:test";

/**
 * For a test that means to test `bun test --aot` over layers: fails unless the run whose stderr this is was built that way.
 * The flags, the size of the project and the platform all have a say in how a run is built, and a run in another form passes as
 * well, so a test that does not ask tests nothing. A run says its form where `BUN_DEBUG_TEST_AOT_WORDS` has a word that begins
 * with `TestRun`: `TestRunLayers:1` to `TestRunLayers:7` bring so many layers whatever the flags and the size are, and
 * `TestRunSaysItsForm` changes nothing. `run()` of ./run.ts asks by itself where the environment has one of the first.
 *
 * Where the Bun under test loads one program a realm (macOS, Windows, a hardened build) there are no layers to ask for.
 */
export function expectLayers(stderr: string, layers: number = 2) {
  // With the log of the phases other lines begin like it.
  const form = stderr.match(/^AOT test run \| ((?:layers|one program|programs without layers)\b.*)$/m)?.[1];
  if (form?.includes("this Bun loads one program a realm")) return;
  expect(form).toStartWith(`layers ${layers} |`);
}
