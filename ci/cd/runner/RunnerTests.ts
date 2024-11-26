import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSafe } from "../../machine/context/process.ts";
import { getRunnerOptions } from "./RunnerOptions.ts";
import { Test } from "./Test.ts";

// runner.node.mjs missing type
type Vendor = any;

export class RunnerTests {
  static getTests = (cwd: string): string[] => {
    function* getFiles(cwd: string, path: string) {
      const dirname = join(cwd, path);
      for (const entry of readdirSync(dirname, { encoding: "utf-8", withFileTypes: true })) {
        const { name } = entry;
        const filename = join(path, name);
        if (Test.isHidden(filename)) {
          continue;
        }
        if (entry.isFile() && Test.isTest(filename)) {
          yield filename;
        } else if (entry.isDirectory()) {
          yield* getFiles(cwd, filename);
        }
      }
    }
    return [...getFiles(cwd, "")].sort();
  };

  static getVendorTests = async function (cwd: string) {
    const {
      timeouts: { testTimeout },
      options,
      filters,
    } = getRunnerOptions();

    const vendorPath = join(cwd, "test", "vendor.json");
    if (!existsSync(vendorPath)) {
      throw new Error(`Did not find vendor.json: ${vendorPath}`);
    }

    const vendors: Vendor[] = JSON.parse(readFileSync(vendorPath, "utf-8")).sort(
      (a: { package: string; tag: string }, b: { package: any; tag: any }) =>
        a.package.localeCompare(b.package) || a.tag.localeCompare(b.tag),
    );

    const shardId = parseInt(options["shard"]);
    const maxShards = parseInt(options["max-shards"]);

    let relevantVendors: Vendor[] = [];
    if (maxShards > 1) {
      for (let i = 0; i < vendors.length; i++) {
        if (i % maxShards === shardId) {
          relevantVendors.push(vendors[i]);
        }
      }
    } else {
      relevantVendors = vendors.flat();
    }

    return Promise.all(
      relevantVendors.map(
        async ({ package: name, repository, tag, testPath, testExtensions, testRunner, packageManager, skipTests }) => {
          const vendorPath = join(cwd, "vendor", name);

          if (!existsSync(vendorPath)) {
            // @ts-ignore
            await spawnSafe({
              command: "git",
              args: ["clone", "--depth", "1", "--single-branch", repository, vendorPath],
              timeout: testTimeout,
              cwd,
            });
          }

          // @ts-ignore
          await spawnSafe({
            command: "git",
            args: ["fetch", "--depth", "1", "origin", "tag", tag],
            timeout: testTimeout,
            cwd: vendorPath,
          });

          const packageJsonPath = join(vendorPath, "package.json");
          if (!existsSync(packageJsonPath)) {
            throw new Error(`Vendor '${name}' does not have a package.json: ${packageJsonPath}`);
          }

          const testPathPrefix = testPath || "test";
          const testParentPath = join(vendorPath, testPathPrefix);
          if (!existsSync(testParentPath)) {
            throw new Error(`Vendor '${name}' does not have a test directory: ${testParentPath}`);
          }

          const isTest = (path: string) => {
            if (!Test.isJavaScriptTest(path)) {
              return false;
            }

            if (typeof skipTests === "boolean") {
              return !skipTests;
            }

            if (typeof skipTests === "object") {
              for (const [glob, reason] of Object.entries(skipTests)) {
                const pattern = new RegExp(`^${glob.replace(/\*/g, ".*")}$`);
                if (pattern.test(path) && reason) {
                  return false;
                }
              }
            }

            return true;
          };

          const testPaths = readdirSync(testParentPath, { encoding: "utf-8", recursive: true })
            .filter((filename: string) =>
              testExtensions ? testExtensions.some((ext: any) => filename.endsWith(`.${ext}`)) : isTest(filename),
            )
            .map((filename: any) => join(testPathPrefix, filename))
            .filter(
              (filename: any) =>
                !filters?.length ||
                filters.some((filter: any) => join(vendorPath, filename).replace(/\\/g, "/").includes(filter)),
            );

          return {
            cwd: vendorPath,
            packageManager: packageManager || "bun",
            testRunner: testRunner || "bun",
            testPaths,
          };
        },
      ),
    );
  };
  static getRelevantTests = (cwd: string) => {
    const tests = RunnerTests.getTests(cwd);
    const { options, filters } = getRunnerOptions();

    const availableTests: string[] = [];
    const filteredTests: string[] = [];

    const isMatch = (testPath: string, filter: any) => {
      return testPath.replace(/\\/g, "/").includes(filter);
    };

    const getFilter = (filter: string) => {
      return (
        filter
          ?.split(",")
          .map((part: string) => part.trim())
          .filter(Boolean) ?? []
      );
    };

    const includes = options["include"]?.flatMap(getFilter);
    if (includes?.length) {
      availableTests.push(...tests.filter(testPath => includes.some(filter => isMatch(testPath, filter))));
      console.log("Including tests:", includes, availableTests.length, "/", tests.length);
    } else {
      availableTests.push(...tests);
    }

    const excludes = options["exclude"]?.flatMap(getFilter);
    if (excludes?.length) {
      const excludedTests = availableTests.filter(testPath => excludes.some(filter => isMatch(testPath, filter)));
      if (excludedTests.length) {
        for (const testPath of excludedTests) {
          const index = availableTests.indexOf(testPath);
          if (index !== -1) {
            availableTests.splice(index, 1);
          }
        }
        console.log("Excluding tests:", excludes, excludedTests.length, "/", availableTests.length);
      }
    }

    const shardId = parseInt(options["shard"]);
    const maxShards = parseInt(options["max-shards"]);
    if (filters?.length) {
      filteredTests.push(
        ...availableTests.filter(testPath => filters.some((filter: any) => isMatch(testPath, filter))),
      );
      console.log("Filtering tests:", filteredTests.length, "/", availableTests.length);
    } else if (options["smoke"] !== undefined) {
      const smokePercent = parseFloat(options["smoke"]) || 0.01;
      const smokeCount = Math.ceil(availableTests.length * smokePercent);
      const smokeTests: Set<string> = new Set();
      for (let i = 0; i < smokeCount; i++) {
        const randomIndex = Math.floor(Math.random() * availableTests.length);
        smokeTests.add(availableTests[randomIndex]);
      }

      filteredTests.push(...Array.from(smokeTests));
      console.log("Smoking tests:", filteredTests.length, "/", availableTests.length);
    } else if (maxShards > 1) {
      for (let i = 0; i < availableTests.length; i++) {
        if (i % maxShards === shardId) {
          filteredTests.push(availableTests[i]);
        }
      }
      console.log(
        "Sharding tests:",
        shardId,
        "/",
        maxShards,
        "with tests",
        filteredTests.length,
        "/",
        availableTests.length,
      );
    } else {
      filteredTests.push(...availableTests);
    }

    return filteredTests;
  };
}
