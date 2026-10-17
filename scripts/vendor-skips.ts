// The skip rules of test/vendor.json: the vendored test files the runner does
// not run, and the tests it leaves out of a file it does run.

/**
 * `skipTests` of a package. `true` skips every file. In a map, the key is a glob on the
 * file's path relative to the package's test directory (`*` matches any characters, path
 * separators included). A string (the reason) or `true` skips the file. `{ tests, reason }`
 * runs the file without the tests whose full name contains one of `tests`. The full name
 * is the describe names and the test name joined by one space, not the " > " the reporter
 * prints: "Stream stop stream on canceled request".
 */
export type VendorSkipTests = boolean | Record<string, boolean | string | VendorSkippedTests>;

export interface VendorSkippedTests {
  tests: string[];
  reason: string;
}

function matchingSkips(skipTests: VendorSkipTests | undefined, path: string) {
  if (typeof skipTests !== "object" || skipTests === null) return [];
  return Object.entries(skipTests)
    .filter(([glob, skip]) => skip && new RegExp(`^${glob.replace(/\*/g, ".*")}$`).test(path))
    .map(([, skip]) => skip);
}

export function isVendorTestSkipped(skipTests: VendorSkipTests | undefined, path: string): boolean {
  return skipTests === true || matchingSkips(skipTests, path).some(skip => typeof skip !== "object");
}

/** The `bun test` arguments that leave the skipped tests of a file out. */
export function getVendorTestArgs(skipTests: VendorSkipTests | undefined, path: string): string[] {
  const names = matchingSkips(skipTests, path).flatMap(skip => (typeof skip === "object" ? skip.tests : []));
  if (!names.length) return [];
  // --test-name-pattern only selects, so select every name that contains none of them.
  // A file with no test left then counts as skipped: without --pass-with-no-tests it fails.
  const escaped = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return ["--test-name-pattern", `^(?!.*(?:${escaped.join("|")}))`, "--pass-with-no-tests"];
}
