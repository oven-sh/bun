import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tailwind from "../src/index.ts";

const packageRoot = path.join(import.meta.dirname, "..");

/** A project in a temporary directory that can resolve `tailwindcss` and `bun-plugin-tailwind`. */
function project(files: Record<string, string>) {
  // `.native` also expands the short `RUNNER~1` in the temporary directory of a Windows runner. The dev server does not
  // watch a file whose real path is outside of its working directory.
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bun-plugin-tailwind-")));
  const write = (file: string, contents: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  };
  for (const [file, contents] of Object.entries(files)) write(file, contents);
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.symlinkSync(
    path.join(packageRoot, "node_modules", "tailwindcss"),
    path.join(root, "node_modules", "tailwindcss"),
    "junction",
  );
  fs.symlinkSync(packageRoot, path.join(root, "node_modules", "bun-plugin-tailwind"), "junction");
  return {
    root,
    write,
    [Symbol.dispose]: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Bundles `entrypoints` and returns the text of every CSS output, joined. */
async function buildCss(root: string, ...entrypoints: string[]) {
  const result = await Bun.build({
    root,
    entrypoints: entrypoints.map(entry => path.join(root, entry)),
    plugins: [tailwind],
  });
  const css = await Promise.all(result.outputs.filter(output => output.path.endsWith(".css")).map(o => o.text()));
  return { css: css.join("\n"), outputs: result.outputs };
}

describe("Bun.build", () => {
  test("generates the utilities that the project uses, and no others", async () => {
    using dir = project({
      "src/index.ts": `import "./index.css"; export const a = "underline md:text-[13px] bg-red-500/50";`,
      "src/index.css": `@import "tailwindcss";`,
    });
    const { css } = await buildCss(dir.root, "src/index.ts");
    expect(css).toContain(".underline {");
    expect(css).toContain(".md\\:text-\\[13px\\] {");
    expect(css).toContain(".bg-red-500\\/50 {");
    expect(css).not.toContain(".line-through");
  });

  test("finds candidates in modules that only the module graph reaches", async () => {
    using dir = project({
      "src/index.ts": `import "./index.css"; import "lib";`,
      "src/index.css": `@import "tailwindcss";`,
      // The scan of the file system skips node_modules, so these come from the native hook or not at all.
      "node_modules/lib/package.json": `{ "name": "lib", "main": "index.js" }`,
      "node_modules/lib/index.js": `export const a = "content-['imported']";`,
      "node_modules/lib/unused.js": `export const a = "content-['not-imported']";`,
    });
    const { css } = await buildCss(dir.root, "src/index.ts");
    expect(css).toContain(".content-\\[\\'imported\\'\\]");
    expect(css).not.toContain("not-imported");
  });

  test("hands the extension of a module to the scanner", async () => {
    using dir = project({
      "src/index.ts": `import "./index.css"; import text from "lib/view.slim" with { type: "text" }; export { text };`,
      "src/index.css": `@import "tailwindcss";`,
      "node_modules/lib/package.json": `{ "name": "lib" }`,
      // Only the preprocessor for Slim templates splits `div.flex.underline` into classes.
      "node_modules/lib/view.slim": `div.line-through.overline`,
    });
    const { css } = await buildCss(dir.root, "src/index.ts");
    expect(css).toContain(".line-through {");
    expect(css).toContain(".overline {");
  });

  test("leaves a stylesheet that does not use Tailwind to Bun", async () => {
    using dir = project({ "plain.css": `.plain { color: red }` });
    const { css } = await buildCss(dir.root, "plain.css");
    expect(css.replace(/\/\*.*?\*\/|\s+/g, "")).toBe(".plain{color:red;}");
  });

  test("@apply, theme() and @variant work without utilities", async () => {
    using dir = project({
      "index.css": `
        @reference "tailwindcss";
        .a { @apply font-bold; }
        .b { color: theme(--color-red-500); }
        .c { @variant hover { color: red; } }
      `,
    });
    const { css } = await buildCss(dir.root, "index.css");
    expect(css).toMatch(/\.a \{[^}]*font-weight: /);
    expect(css).not.toContain("theme(");
    expect(css).toContain(".c:hover");
    expect(css).not.toContain("@apply");
    expect(css).not.toContain("@variant");
  });

  test("CSS modules", async () => {
    using dir = project({
      "index.ts": `import styles from "./a.module.css"; export default styles;`,
      "a.module.css": `@reference "tailwindcss"; .title { @apply underline; }`,
    });
    const { css, outputs } = await buildCss(dir.root, "index.ts");
    const js = await outputs.find(output => output.path.endsWith(".js"))!.text();
    const [, name] = js.match(/title: "(title_[\w-]+)"/)!;
    expect(css).toContain(`.${name} {`);
    expect(css).toContain("text-decoration-line: underline");
  });

  test("@plugin and @config load JavaScript of the project", async () => {
    using dir = project({
      "index.ts": `import "./index.css"; export const a = "from-plugin text-brand";`,
      "index.css": `@import "tailwindcss"; @plugin "./plugin.js"; @config "./tailwind.config.js";`,
      "plugin.js": `module.exports = ({ addUtilities }) => addUtilities({ ".from-plugin": { order: "7" } });`,
      "tailwind.config.js": `module.exports = { theme: { extend: { colors: { brand: "#123456" } } } };`,
    });
    const { css } = await buildCss(dir.root, "index.ts");
    expect(css).toMatch(/\.from-plugin \{\s*order: 7;/);
    expect(css).toMatch(/\.text-brand \{\s*color: #123456;/);
  });

  test("@source adds a directory outside of the project root", async () => {
    using dir = project({
      "app/index.css": `@import "tailwindcss" source(none); @source "../shared";`,
      "app/unused.ts": `export const a = "line-through";`,
      "shared/view.html": `<div class="overline"></div>`,
    });
    const { css } = await buildCss(dir.root, "app/index.css");
    expect(css).toContain(".overline {");
    expect(css).not.toContain(".line-through");
  });

  test("source(none) ignores the file system and the module graph", async () => {
    using dir = project({
      "index.ts": `import "./index.css"; export const a = "underline";`,
      "index.css": `@import "tailwindcss" source(none);`,
    });
    const { css } = await buildCss(dir.root, "index.ts");
    expect(css).toContain("@layer");
    expect(css).not.toContain(".underline");
  });

  test('source("./dir") limits the file system and the module graph to that directory', async () => {
    using dir = project({
      "index.ts": `import "./index.css"; import "./in/a.ts"; import "./out/b.ts"; import "./in2/c.ts";`,
      "index.css": `@import "tailwindcss" source("./in");`,
      "in/a.ts": `export const a = "underline";`,
      "out/b.ts": `export const b = "line-through";`,
      "in2/c.ts": `export const c = "overline";`,
    });
    const { css } = await buildCss(dir.root, "index.ts");
    expect(css).toContain(".underline {");
    expect(css).not.toContain(".line-through");
    expect(css).not.toContain(".overline");
  });

  test('source("./file") is an error', async () => {
    using dir = project({
      "index.css": `@import "tailwindcss" source("./a.ts");`,
      "a.ts": `export const a = "underline";`,
    });
    const error: AggregateError = await buildCss(dir.root, "index.css").then(
      () => expect.unreachable(),
      error => error,
    );
    expect(error.errors.map(error => error.message).join("\n")).toContain("The `source(./a.ts)` does not exist");
  });

  test("@source not excludes modules of the graph too", async () => {
    using dir = project({
      "index.ts": `import "./index.css"; import "./legacy/a.ts"; import "./src/b.test.ts"; import "./src/c.ts";`,
      "index.css": `@import "tailwindcss"; @source not "./legacy"; @source not "./src/**/*.test.ts";`,
      "legacy/a.ts": `export const a = "line-through";`,
      "src/b.test.ts": `export const b = "overline";`,
      "src/c.ts": `export const c = "underline";`,
    });
    const { css } = await buildCss(dir.root, "index.ts");
    expect(css).toContain(".underline {");
    expect(css).not.toContain(".line-through");
    expect(css).not.toContain(".overline");
  });

  test("a stylesheet of a package that an isolated install stores under node_modules/.bun is a root", async () => {
    using dir = project({
      "index.ts": `import "ui/index.css"; export const a = "underline";`,
      "node_modules/.bun/ui@1.0.0/node_modules/ui/package.json": `{ "name": "ui" }`,
      "node_modules/.bun/ui@1.0.0/node_modules/ui/index.css": `@import "tailwindcss/utilities";`,
    });
    fs.symlinkSync(
      path.join(dir.root, "node_modules/.bun/ui@1.0.0/node_modules/ui"),
      path.join(dir.root, "node_modules/ui"),
      "junction",
    );
    fs.symlinkSync(
      path.join(packageRoot, "node_modules", "tailwindcss"),
      path.join(dir.root, "node_modules/.bun/ui@1.0.0/node_modules/tailwindcss"),
      "junction",
    );
    const { css } = await buildCss(dir.root, "index.ts");
    expect(css).toContain(".underline {");
    expect(css).not.toContain("@tailwind");
  });

  test("leaves defer() of a plain stylesheet to other plugins", async () => {
    using dir = project({ "index.ts": `import "./plain.css";`, "plain.css": `.plain { color: red }` });
    let deferred = false;
    const result = await Bun.build({
      root: dir.root,
      entrypoints: [path.join(dir.root, "index.ts")],
      plugins: [
        tailwind,
        {
          name: "other",
          setup(build) {
            build.onLoad({ filter: /\.css$/ }, async ({ defer }) => {
              await defer();
              deferred = true;
              return undefined;
            });
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(deferred).toBe(true);
  });

  test("reads a stylesheet of `Bun.build({ files })` from there", async () => {
    using dir = project({
      "index.css": `.disk { color: red }`,
      "a.ts": `export default "underline";`,
    });
    const result = await Bun.build({
      root: dir.root,
      entrypoints: ["index.css", "virtual.css", "late.css"].map(name => path.join(dir.root, name)),
      files: {
        [path.join(dir.root, "index.css")]: `@import "tailwindcss/utilities";`,
        // Bun takes either separator in a key, on every platform.
        [path.join(dir.root, "virtual.css").replaceAll("/", "\\")]: new TextEncoder().encode(
          `.virtual { @apply overline; }`,
        ),
      },
      plugins: [
        tailwind,
        {
          name: "late",
          setup(build) {
            build.config.files![path.join(dir.root, "late.css")] = `.late { @apply line-through; }`;
          },
        },
      ],
    });
    const css = (name: string) => result.outputs.find(output => output.path.endsWith(name))!.text();
    expect(await css("index.css")).toContain(".underline {");
    expect(await css("index.css")).not.toContain(".disk");
    expect(await css("virtual.css")).toContain("text-decoration-line: overline");
    expect(await css("late.css")).toContain("text-decoration-line: line-through");
  });

  test("does not read assets", async () => {
    using dir = project({
      "index.ts": `import "./index.css"; import url from "./a.png"; export { url };`,
      "index.css": `@import "tailwindcss/utilities";`,
      // The scan of the disk skips it too, so only the native hook could find this.
      "a.png": `underline`,
    });
    const { css } = await buildCss(dir.root, "index.ts");
    expect(css).not.toContain(".underline");
  });

  test("each root gets the candidates of its own sources", async () => {
    using dir = project({
      "index.ts": `import "./one.css"; import "./two.css"; import "./one/a.ts"; import "./two/b.ts";`,
      "one.css": `@import "tailwindcss/utilities" source("./one"); .marker-one { order: 1 }`,
      "two.css": `@import "tailwindcss/utilities" source("./two"); .marker-two { order: 2 }`,
      "one/a.ts": `export const a = "underline";`,
      "two/b.ts": `export const b = "line-through";`,
    });
    const { css } = await buildCss(dir.root, "index.ts");
    const [one, two] = css.split(".marker-one");
    expect(one).toContain(".underline {");
    expect(one).not.toContain(".line-through");
    expect(two).toContain(".line-through {");
    expect(two).not.toContain(".underline {");
  });
});

describe("dev server", () => {
  async function serve(root: string) {
    const server = Bun.spawn({
      cmd: [process.execPath, "server.ts"],
      cwd: root,
      // The timings show in `log` which builds generated the stylesheet again.
      env: { ...process.env, DEBUG: "tailwindcss", NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    // What the server printed, for the message of a test that gives up.
    let log = "";
    let stdout = "";
    const listening = Promise.withResolvers<string>();
    for (const stream of [server.stdout, server.stderr]) {
      void (async () => {
        for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
          log += chunk;
          if (stream !== server.stdout) continue;
          stdout += chunk;
          const url = stdout.match(/^(http:.*)\n/m)?.[1];
          if (url) listening.resolve(url.trim());
        }
      })();
    }
    void server.exited.then(code => listening.reject(new Error(`the server exited with code ${code}\n${log}`)));
    const url = await listening.promise;

    async function page() {
      const response = await fetch(url);
      const href = (await response.text()).match(/href="([^"]+\.css)"/)?.[1];
      return { status: response.status, css: href ? await (await fetch(new URL(href, url))).text() : "" };
    }

    return {
      page,
      /** Polls the page until `done` accepts it. */
      async until(done: (current: Awaited<ReturnType<typeof page>>) => boolean) {
        const deadline = Date.now() + 20_000;
        for (;;) {
          const current = await page();
          if (done(current)) return;
          if (Date.now() > deadline) {
            const utilities = current.css.slice(current.css.indexOf("@layer utilities {"));
            throw new Error(`gave up at status ${current.status}\n--- utilities\n${utilities}\n--- server\n${log}`);
          }
          await Bun.sleep(25);
        }
      },
      [Symbol.asyncDispose]: async () => {
        server.kill();
        await server.exited;
      },
    };
  }

  const files = {
    "bunfig.toml": `[serve.static]\nplugins = ["bun-plugin-tailwind"]\n`,
    "index.html": `<!doctype html><link rel="stylesheet" href="./index.css" /><script type="module" src="./app.ts"></script>`,
    "server.ts": `
      import index from "./index.html";
      const server = Bun.serve({ port: 0, development: true, routes: { "/": index } });
      console.log(server.url.href);
    `,
  };

  test("serves the utilities of an HTML route and follows edits", async () => {
    using dir = project({
      ...files,
      "index.css": `@import "tailwindcss";`,
      "app.ts": `document.body.className = "underline";`,
    });
    await using server = await serve(dir.root);

    const { css } = await server.page();
    expect(css).toContain(".underline {");
    expect(css).not.toContain(".line-through");

    dir.write("app.ts", `document.body.className = "line-through";`);
    await server.until(({ css }) => css.includes(".line-through {"));
  }, 60_000);

  test("recovers from a stylesheet that Tailwind rejected", async () => {
    using dir = project({
      ...files,
      "index.css": `@import "tailwindcss"; .btn { @apply underline; }`,
      "app.ts": `document.body.className = "flex";`,
    });
    await using server = await serve(dir.root);
    expect((await server.page()).css).toMatch(/\.btn \{\s*text-decoration-line: underline;/);

    dir.write("index.css", `@import "tailwindcss"; .btn { @apply no-such-class; }`);
    dir.write("app.ts", `document.body.className = "grid";`);
    // The page fails, or the next request already gets the CSS of the last compiler that worked.
    await server.until(({ status, css }) => status === 500 || css.includes(".grid {"));

    dir.write("index.css", `@import "tailwindcss"; .btn { @apply overline; }`);
    await server.until(({ css }) => /\.btn \{\s*text-decoration-line: overline;/.test(css));
  }, 60_000);

  test("recovers from a @plugin that threw", async () => {
    using dir = project({
      ...files,
      "index.css": `@import "tailwindcss"; @plugin "./plugin.js";`,
      "plugin.js": `module.exports = ({ addBase }) => addBase({ ".marker": { order: "1" } });`,
      "app.ts": `document.body.className = "underline";`,
    });
    await using server = await serve(dir.root);
    expect((await server.page()).css).toMatch(/\.marker \{\s*order: 1;/);

    // The dev server does not watch plugin.js, so an edit of a module starts each rebuild.
    dir.write("plugin.js", `throw new Error("broken on purpose");`);
    dir.write("app.ts", `document.body.className = "overline";`);
    await server.until(({ status, css }) => status === 500 || css.includes(".overline {"));

    dir.write("plugin.js", `module.exports = ({ addBase }) => addBase({ ".marker": { order: "3" } });`);
    dir.write("app.ts", `document.body.className = "line-through";`);
    await server.until(({ css }) => /\.marker \{\s*order: 3;/.test(css));
  }, 60_000);
});
