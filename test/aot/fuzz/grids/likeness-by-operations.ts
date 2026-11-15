// ../../servers/a-test-run-compiles-what-an-executable-compiles.test.ts holds a test run to the executable by the bytes of each function. One form of a run can't be
// held that way, and it is the form that a large suite runs in:
//
//   --isolate (--parallel implies it): each test file gets a realm, and every test of an object's shape also asks whether the object is of this realm. An
//   object can get from one file to the next (../../isolate-doors.test.ts), so that is needed. It changes the bytes of each function that has such a test.
//
// So here a function counts as alike where it has as many bytes or was made of the same operations, each as often: the compiler's map lists both.
// What a program needs to run more than once in a process isn't counted. The share of the executable's functions that are alike is held from below.
//
//   A share that falls: the compiler has given up something more where a program runs in several realms.
//   A share that rises: raise the number here. It prints one line a server and form that begins with ALIKE.
import { expect } from "bun:test";
import { readdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../../harness/commands";
import { afterAll, raiseDefaultTimeout } from "../../harness/default-timeout";
import { buildEnvironment, compileCommand } from "../../harness/flags";
import { beforeAll, describe, test } from "../../supported";
import { operationsOfProgram } from "../../servers/functions-of-a-map";
import { copyApp } from "../../servers/run-servers";

raiseDefaultTimeout(120_000);

/** Percent of the executable's functions, rounded down, on Linux x64, less one. */
const alikeAtLeast: Record<string, Record<string, number>> = {
  hono: { plain: 98, isolate: 88 },
  express: { plain: 98, isolate: 90 },
  fastify: { plain: 87, isolate: 79 },
};
/** The same where another test file runs first, as in every project with two. */
const alikeBehindAnotherFileAtLeast: Record<string, Record<string, number>> = {
  hono: { plain: 95, isolate: 86 },
  express: { plain: 83, isolate: 76 },
  fastify: { plain: 79, isolate: 71 },
};
const servers = Object.keys(alikeAtLeast);
const forms = ["plain", "isolate"];
const places = ["", " behind another file"];

describe.skipIf(!isLinux || process.arch !== "x64")(
  "a test run is made of the executable's operations: servers",
  () => {
    const work = String(tempDir("aot-servers-likeness", {}));
    const app = join(work, "app");
    const shares = new Map<string, { alike: number; executable: number; withOperations: number }>();
    afterAll(() => rmSync(work, { recursive: true, force: true }));

    beforeAll(async () => {
      await copyApp(app);
      const mapsOf = (name: string) => readdirSync(work).filter(file => file.startsWith(`${name}.map.`)).map(file => join(work, file)); // prettier-ignore
      const withMaps = (name: string) => ({
        ...bunEnv,
        PORT: "0",
        [buildEnvironment.mapFilePath]: join(work, `${name}.map.%p`),
      });
      const executableOf = (server: string, name: string) =>
        slot(async () => {
          const executable = join(work, `${name}${isWindows ? ".exe" : ""}`);
          built(await spawned([bunExe(), ...compileCommand, "--target=bun", `./${server}.ts`, "--outfile", executable], app, withMaps(name))); // prettier-ignore
          rmSync(executable, { force: true });
          return operationsOfProgram(mapsOf(name));
        });
      const testRunOf = (server: string, name: string, flags: string[], ahead: string[] = []) =>
        slot(async () => {
          await spawned([bunExe(), "test", "--aot", ...flags, ...ahead, `./${server}.test.ts`], app, withMaps(name)); // prettier-ignore
          return operationsOfProgram(mapsOf(name));
        });
      writeFileSync(join(app, "0-first.test.ts"), `import { test } from "bun:test";\ntest("first", () => {});\n`);
      for (const server of servers) {
        // The server listens from then on, so the one test ends the process.
        writeFileSync(
          join(app, `${server}.test.ts`),
          `import { test } from "bun:test";\nimport "./${server}.ts";\ntest("is loaded", () => process.exit(0));\n`,
        );
      }
      await Promise.all(
        servers.map(async server => {
          const first = ["./0-first.test.ts"];
          const [executable, plain, isolate, plainBehind, isolateBehind] = await Promise.all([
            executableOf(server, `${server}-executable`),
            testRunOf(server, `${server}-plain`, []),
            testRunOf(server, `${server}-isolate`, ["--isolate"]),
            testRunOf(server, `${server}-behind-plain`, [], first),
            testRunOf(server, `${server}-behind-isolate`, ["--isolate"], first),
          ]);
          const runs = {
            plain,
            isolate,
            "plain behind another file": plainBehind,
            "isolate behind another file": isolateBehind,
          };
          const withOperations = [...executable.values()].filter(it => it.operations !== "").length;
          for (const [form, ofRun] of Object.entries(runs)) {
            const isAlike = ([key, it]: [string, { bytes: string; operations: string }]) => {
              const other = ofRun.get(key);
              // Two functions whose operations the map doesn't list are not thereby made of the same ones.
              return (
                other !== undefined &&
                (other.bytes === it.bytes || (it.operations !== "" && other.operations === it.operations))
              );
            };
            shares.set(`${server} ${form}`, { alike: [...executable].filter(isAlike).length, executable: executable.size, withOperations }); // prettier-ignore
          }
        }),
      );
    }, 900_000);

    const cases = servers.flatMap(server => places.flatMap(place => forms.map(form => [server, form, place])));
    test.each(cases)("%s, %s%s", (server, form, place) => {
      const { alike, executable, withOperations } = shares.get(`${server} ${form}${place}`)!;
      const percent = Math.floor((100 * alike) / executable);
      console.log(
        `ALIKE ${server} ${form}${place}: ${percent}% (${alike} of the executable's ${executable} functions)`,
      );
      expect(executable).toBeGreaterThan(500);
      expect(withOperations).toBeGreaterThan(500);
      const atLeast = (place ? alikeBehindAnotherFileAtLeast : alikeAtLeast)[server][form];
      expect({ server, form, percent: Math.min(percent, atLeast) }).toEqual({ server, form, percent: atLeast });
    });
  },
);
