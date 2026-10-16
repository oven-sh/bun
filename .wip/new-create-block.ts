// `bun create <npm template>` runs `create-<template>` through bunx, so the
// install of the template takes bunfig.toml and .npmrc from the project that
// `bun create` runs in.
// https://github.com/oven-sh/bun/issues/13247
describe("the registry of a scoped npm template comes from the project", () => {
  const layouts = {
    "a directory with no package.json": { files: {}, cwd: "." },
    "a subdirectory of the project": {
      files: { "package.json": JSON.stringify({ name: "proj", version: "1.0.0" }), apps: { keep: "" } },
      cwd: "apps",
    },
  };
  const configs = {
    "bunfig.toml": (url: string) => ({ "bunfig.toml": `[install.scopes]\nbun13247test = { url = "${url}" }\n` }),
    ".npmrc": (url: string) => ({ ".npmrc": `@bun13247test:registry=${url}\n` }),
  };

  describe.each(Object.entries(layouts))("from %s", (_, layout) => {
    it.concurrent.each(Object.entries(configs))("in %s", async (_, config) => {
      using scoped = new TestRegistry().start();
      using dir = tempDir("create-scope", { ...layout.files, ...config(scoped.url) });

      const { err, exitCode } = await create(join(String(dir), layout.cwd), ["@bun13247test/package"], {
        npm_config_registry: registry.url,
      });

      expect(err.split(/\r?\n/)).toContain(`error: GET ${scoped.url}@bun13247test%2fcreate-package - 404`);
      expect(exitCode).toBe(1);
    });
  });
});

