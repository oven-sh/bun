// Which docker-compose services a test file asks for, read from its source.
//
// scripts/runner.node.ts asks once per test file. It runs the docker-backed
// files after the other serial files of the shard, keeps them out of the
// `bun test --parallel` bucket, and passes the services of the shard's files
// to test/docker/coordinator.ts, which starts them when the shard launches.
// scripts/update-parallel-allowlist.mjs asks the same question so that a
// docker-backed file is never allowlisted.
//
// The rule reads text. A file is docker-backed when it calls
// describeWithContainer(), imports test/docker/index.ts, or imports a helper
// module listed in helperServices. The rule can name a service only when the
// request holds it as a string literal (see servicesInSource). For any other
// request (a computed name) the coordinator starts the service when a test
// first asks for it, and that test waits for the container. A request through
// a helper module that is not listed is not seen at all: that file is not
// docker-backed for the runner.
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { isServiceName, type ServiceName } from "../test/docker/service-names.mts";

/**
 * Helper modules that ask for a service on behalf of the tests that import
 * them. Keys are relative to test/, without the extension. The rule does not
 * follow imports, so a helper needs an entry here. A test file never does.
 */
export const helperServices: Readonly<Record<string, readonly ServiceName[]>> = {
  "js/valkey/test-utils": ["redis_unified"],
};

/** The specifiers of `from "x"`, `import "x"`, `import("x")` and `require("x")` in `source`. */
const importSpecifiers = (source: string) =>
  Array.from(
    source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g),
    match => match[2]!,
  );

const callsDescribeWithContainer = (source: string) => /\bdescribeWithContainer\s*\(/.test(source);

const importsDockerIndex = (source: string) =>
  source.includes("docker/index") &&
  importSpecifiers(source).some(specifier => /(?:^|\/)docker\/index(?:\.ts)?$/.test(specifier));

const helpers = Object.entries(helperServices).map(([helper, services]) => ({
  helper,
  basename: posix.basename(helper),
  services,
}));

/**
 * The services of the helperServices modules that `source` imports by
 * relative path, or undefined when it imports none. `path` is the file that
 * holds `source`, relative to test/.
 */
function servicesOfImportedHelpers(source: string, path: string): ServiceName[] | undefined {
  if (!helpers.some(({ basename }) => source.includes(basename))) return undefined;
  let services: ServiceName[] | undefined;
  for (const specifier of importSpecifiers(source)) {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
    const imported = posix.join(posix.dirname(path), specifier).replace(/\.[cm]?[jt]sx?$/, "");
    for (const entry of helpers) {
      if (entry.helper === imported) (services ??= []).push(...entry.services);
    }
  }
  return services;
}

/** What the rule reads in one file. */
interface Requests {
  /** The file asks for a service, whether or not the rule can name it. */
  readonly backed: boolean;
  /** The services the rule can name, sorted. */
  readonly services: readonly ServiceName[];
}

/** `path` is the file that holds `source`, relative to test/. Without it no helper module is looked up. */
function requestsIn(source: string, path?: string): Requests {
  const services = new Set<ServiceName>();
  const add = (name: string) => {
    if (isServiceName(name)) services.add(name);
  };
  const harness = callsDescribeWithContainer(source);
  if (harness) {
    for (const [, , image] of source.matchAll(/\bimage:\s*(["'`])([a-z0-9_:]+)\1/g)) {
      if (image === "mysql:8" || image === "mysql:9") {
        add("mysql_plain");
        add("mysql_native_password");
      } else {
        add(image!);
      }
    }
  }
  const index = importsDockerIndex(source);
  if (index) {
    for (const [, , name] of source.matchAll(/\(\s*(["'`])([a-z0-9_]+)\1/g)) add(name!);
  }
  const helper = path === undefined ? undefined : servicesOfImportedHelpers(source, path);
  for (const service of helper ?? []) services.add(service);
  return { backed: harness || index || helper !== undefined, services: Object.freeze([...services].sort()) };
}

/**
 * The services that one source text asks for with a string literal, sorted.
 *
 * - In a text that calls describeWithContainer(): each `image: "<service>"`.
 *   "mysql:8" and "mysql:9" count as both services that describeWithContainer()
 *   chooses between at run time.
 * - In a text that imports test/docker/index.ts: each service name that is the
 *   first argument of a call, such as `ensure("<service>")`.
 */
export function servicesInSource(source: string): readonly ServiceName[] {
  return requestsIn(source).services;
}

const none: Requests = Object.freeze({ backed: false, services: Object.freeze([]) });
const cache = new Map<string, Requests>();

/** Reads the file once per process. A file that cannot be read asks for nothing. */
function requestsOf(testsDir: string, testPath: string): Requests {
  const path = testPath.replaceAll("\\", "/");
  const key = `${testsDir}\0${path}`;
  let requests = cache.get(key);
  if (requests === undefined) {
    let source: string | undefined;
    try {
      source = readFileSync(`${testsDir}/${path}`, "utf8");
    } catch {}
    requests = source === undefined ? none : requestsIn(source, path);
    cache.set(key, requests);
  }
  return requests;
}

/**
 * Whether the test file at `testPath` asks for a docker-compose service.
 * `testsDir` is the absolute path of test/. `testPath` is relative to it, with
 * either separator.
 *
 * The caller decides which files are worth a read: only a `bun test` file can
 * ask for a service.
 */
export function isDockerBacked(testsDir: string, testPath: string): boolean {
  return requestsOf(testsDir, testPath).backed;
}

/**
 * The docker-compose services that the test file at `testPath` asks for and
 * that the rule can name, sorted. A docker-backed file can have none.
 */
export function dockerServicesFor(testsDir: string, testPath: string): readonly ServiceName[] {
  return requestsOf(testsDir, testPath).services;
}

/** The services to start when a shard that runs `testPaths` launches: the sorted union over its files. */
export function dockerServicesForShard(testsDir: string, testPaths: readonly string[]): ServiceName[] {
  return [...new Set(testPaths.flatMap(testPath => dockerServicesFor(testsDir, testPath)))].sort();
}
