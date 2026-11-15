// A folder without a tsconfig.json: `tsc main.ts` reads its default library, which declares the DOM. A build stops only where tsc reports an error,
// so a name or a type of the DOM stops none, and what `Response.prototype.json` answers is `any` as it is there.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const programs: Record<string, { text: string; stdout: string }> = {
  "a window is asked for": {
    text: `export {};\nconst place = typeof window === "undefined" ? "no window" : "a window";\nconsole.log(place);\n`,
    stdout: "no window\n",
  },
  "a document is asked for": {
    text: `export {};\nconst place = typeof document === "undefined" ? "no document" : "a document";\nconsole.log(place);\n`,
    stdout: "no document\n",
  },
  "a variable is declared to hold an element": {
    text: `export {};\nlet root: HTMLElement | null = null;\nconsole.log(root === null);\n`,
    stdout: "true\n",
  },
  "a parameter is declared by a type that the DOM alone declares": {
    text: `export {};\nfunction withToken(extra: HeadersInit): Headers {\n  const headers = new Headers(extra);\n  headers.set("authorization", "made-up");\n  return headers;\n}\nconsole.log(withToken({ accept: "text/plain" }).get("authorization"));\n`,
    stdout: "made-up\n",
  },
  "what a response parses comes through a function of the program": {
    text: `export {};\nfunction parse(text: string) {\n  return new Response(text).json();\n}\nconst parcel = await parse('{"weight": 3}');\nconsole.log(parcel.weight);\n`,
    stdout: "3\n",
  },
};

describe.skipIf(!!unsupported)("a build without a tsconfig.json", () => {
  for (const [name, { text, stdout }] of Object.entries(programs)) {
    test(name, () =>
      slot(async () => {
        using dir = tempDir("aot-defaults-of-tsc", { "main.ts": text });
        const folder = String(dir);
        const built = await spawned(
          [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation, "./main.ts", "--outfile", "main"],
          folder,
          env,
        );
        expect({
          errors: built.stderr.split("\n").filter(line => line.startsWith("error:")),
          exitCode: built.exitCode,
        }).toEqual({
          errors: [],
          exitCode: 0,
        });
        const ran = await spawned([join(folder, isWindows ? "main.exe" : "main")], folder, env);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout, exitCode: 0 });
      }),
    );
  }

  test("a name that nothing declares stops it", () =>
    slot(async () => {
      using dir = tempDir("aot-defaults-of-tsc", { "main.ts": `export {};\nconsole.log(typeof neverDeclared);\n` });
      const built = await spawned(
        [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation, "./main.ts", "--outfile", "main"],
        String(dir),
        env,
      );
      expect({ stops: built.stderr.includes("error: TS2304"), exitCode: built.exitCode }).toEqual({
        stops: true,
        exitCode: 1,
      });
    }));
});
