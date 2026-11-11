declare var $visibility: "Public" | "Private" | "PrivateRecursive";
declare function $bindgen(file: string, symbol: string): (ownGlobals: boolean) => number;

// What a test file asks of the run while it loads: `askedByCompiledTestFile` in src/runtime/test_runner/jest.bind.ts says what it asks.
// The build alone writes a call of this function, so nothing that a program hands to `Bun.jest` is taken for a question.
// The answer is a number: every test run holds this file, and what it names may bring nothing of the runner along.
$visibility = "Private";
export function askRunOfTestFile(ownGlobals: boolean): number {
  return $bindgen("jest.bind.ts", "askedByCompiledTestFile")(ownGlobals);
}
