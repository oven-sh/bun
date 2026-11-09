/**
 * `skipTests` of a package in test/vendor.json. `true` skips every file. In a map, a key is a glob on the file's path
 * under the package's test directory: `*` matches any characters, path separators too, and no other character is
 * special. A string (the reason) or `true` skips the file. `{ tests, reason }` runs the file without the tests whose
 * full name is in `tests`. `bun test` joins the describe names and the test name with one space: "Stream stop stream
 * on canceled request", with no " > ".
 */
export type VendorSkipTests = boolean | Record<string, boolean | string | { tests: string[]; reason: string }>;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matchingSkips(skipTests: VendorSkipTests | undefined, path: string) {
  if (typeof skipTests !== "object" || skipTests === null) return [];
  return Object.entries(skipTests)
    .filter(([glob, skip]) => skip && new RegExp(`^${glob.split("*").map(escapeRegExp).join(".*")}$`).test(path))
    .map(([, skip]) => skip);
}

export function isVendorTestSkipped(skipTests: VendorSkipTests | undefined, path: string): boolean {
  return skipTests === true || matchingSkips(skipTests, path).some(skip => typeof skip !== "object");
}

/** The `bun test` arguments that leave the skipped tests of a file out. */
export function getVendorTestArgs(skipTests: VendorSkipTests | undefined, path: string): string[] {
  const names = matchingSkips(skipTests, path).flatMap(skip => (typeof skip === "object" ? skip.tests : []));
  if (!names.length) return [];
  // --test-name-pattern can only select. Without --pass-with-no-tests, a file with no test left fails.
  return ["--test-name-pattern", `^(?!(?:${names.map(escapeRegExp).join("|")})$)`, "--pass-with-no-tests"];
}
