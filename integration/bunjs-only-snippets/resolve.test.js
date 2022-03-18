import { it, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

it("import.meta.resolve", async () => {
  expect(await import.meta.resolve("./resolve.test.js")).toBe(import.meta.url);

  expect(await import.meta.resolve("./resolve.test.js", import.meta.url)).toBe(
    import.meta.url
  );

  expect(
    // optional second param can be any path, including a dir
    await import.meta.resolve(
      "./bunjs-only-snippets/resolve.test.js",
      join(import.meta.url, "../")
    )
  ).toBe(import.meta.url);

  // can be a package path
  expect((await import.meta.resolve("react", import.meta.url)).length > 0).toBe(
    true
  );

  // file extensions are optional
  expect(await import.meta.resolve("./resolve.test")).toBe(import.meta.url);

  // works with tsconfig.json "paths"
  expect(await import.meta.resolve("foo/bar")).toBe(
    join(import.meta.url, "../baz.js")
  );

  // works with package.json "exports"
  writePackageJSONExportsFixture();
  expect(await import.meta.resolve("package-json-exports/baz")).toBe(
    join(import.meta.url, "../node_modules/package-json-exports/foo/bar.js")
  );

  expect(await import.meta.resolve("./resolve-typescript-file.tsx")).toBe(
    join(import.meta.url, "../resolve-typescript-file.tsx")
  );
  expect(await import.meta.resolve("./resolve-typescript-file.js")).toBe(
    join(import.meta.url, "../resolve-typescript-file.tsx")
  );

  // works with typescript edgecases like:
  // - If the file ends with .js and it doesn't exist, try again with .ts and .tsx
  expect(await import.meta.resolve("./resolve-typescript-file.js")).toBe(
    join(import.meta.url, "../resolve-typescript-file.tsx")
  );
  expect(await import.meta.resolve("./resolve-typescript-file.tsx")).toBe(
    join(import.meta.url, "../resolve-typescript-file.tsx")
  );

  try {
    await import.meta.resolve("THIS FILE DOESNT EXIST");
    throw new Error("Test failed");
  } catch (exception) {
    expect(exception instanceof ResolveError).toBe(true);
    expect(exception.referrer).toBe(import.meta.url);
    expect(exception.name).toBe("ResolveError");
  }
});

// the slightly lower level API, which doesn't prefill the second param
// and expects a directory instead of a filepath
it("Bun.resolve", async () => {
  expect(await Bun.resolve("./resolve.test.js", import.meta.dir)).toBe(
    import.meta.url
  );
});

// synchronous
it("Bun.resolveSync", () => {
  expect(Bun.resolveSync("./resolve.test.js", import.meta.dir)).toBe(
    import.meta.url
  );
});

function writePackageJSONExportsFixture() {
  try {
    mkdirSync(
      join(import.meta.dir, "./node_modules/package-json-exports/foo"),
      {
        recursive: true,
      }
    );
  } catch (exception) {}
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-exports/foo/bar.js"),
    "export const bar = 1;"
  );
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-exports/package.json"),
    JSON.stringify(
      {
        name: "package-json-exports",
        exports: {
          "./baz": "./foo/bar.js",
        },
      },
      null,
      2
    )
  );
}
