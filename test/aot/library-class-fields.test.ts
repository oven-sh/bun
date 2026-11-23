import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "./with-compiler";

const compilerOptions = {
  strict: true,
  module: "esnext",
  moduleResolution: "bundler",
  target: "esnext",
  types: [],
  lib: ["esnext", "dom"],
  skipLibCheck: true,
};

const files = {
  "library/package.json": JSON.stringify({ name: "shelves", version: "1.2.3" }),
  "library/src/shelf.js": `class Shelf {
  constructor() {
    this.label = "oak";
    this.width = 40;
  }
  get count() {
    return 2;
  }
}
export class OpenShelf extends Shelf {
  label;
  width;
}
export class CountedShelf extends Shelf {
  count = 3;
}
`,
  "library/src/shelf.d.ts": `export declare class OpenShelf {
  label: string | undefined;
  width: number | undefined;
}
export declare class CountedShelf {
  count: number;
}
`,
  "library/src/index.ts": `import { CountedShelf, OpenShelf } from "./shelf.js";
class Plank {
  length: number = 60;
  name: string | undefined;
}
export function openShelf(): string {
  const shelf = new OpenShelf();
  return shelf.label + " " + shelf.width + " " + Object.keys(shelf).join();
}
export function countedShelf(): number {
  return new CountedShelf().count;
}
export function plank(): string {
  const plank = new Plank();
  return plank.length + " " + Object.keys(plank).join();
}
`,
  "app/tsconfig.json": JSON.stringify({ compilerOptions }),
  "app/package.json": JSON.stringify({ name: "app", dependencies: { shelves: "1.2.3" } }),
  "app/app.ts": `import { countedShelf, openShelf, plank } from "shelves";
console.log(openShelf());
console.log(plank());
console.log(countedShelf());
`,
};

const env = { ...bunEnv, NO_COLOR: "1" };

async function spawned(cwd: string, ...cmd: string[]) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("the classes of a library", () => {
  test.each([
    ["nothing", undefined, "60 length,name"],
    ["true", true, "60 length,name"],
    ["false", false, "60 length"],
  ])("define their fields in a program that installs it (useDefineForClassFields: %s)", async (_, option, plank) => {
    using dir = tempDir("aot-library-class-fields", {
      ...files,
      "library/tsconfig.json": JSON.stringify({
        compilerOptions: { ...compilerOptions, useDefineForClassFields: option },
      }),
    });
    const [library, app] = [join(String(dir), "library"), join(String(dir), "app")];
    expect(await spawned(library, bunExe(), "compile", "--library", "src/index.ts")).toMatchObject({
      stderr: "",
      exitCode: 0,
    });
    expect(existsSync(join(library, "dist/index.aot.ts"))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(library, "dist/package.json"), "utf8"));
    expect(manifest.compilerOptions.useDefineForClassFields).toBe(option === undefined ? undefined : true);
    cpSync(join(library, "dist"), join(app, "node_modules/shelves"), { recursive: true });
    const said = { stdout: `undefined undefined label,width\n${plank}\n3\n`, stderr: "", exitCode: 0 };
    expect(await spawned(app, bunExe(), "app.ts")).toEqual(said);
    expect(await spawned(app, bunExe(), "run", "--aot", "app.ts")).toEqual(said);
    expect(await spawned(app, bunExe(), "compile", "./app.ts")).toMatchObject({ exitCode: 0 });
    expect(await spawned(app, join(app, isWindows ? "app.exe" : "app"))).toEqual(said);
  });
});
