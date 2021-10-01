const puppeteer = require("puppeteer");
const http = require("http");
const path = require("path");
const url = require("url");
const fs = require("fs");
const child_process = require("child_process");
const snippetsDir = path.resolve(__dirname, "../snippets");
const serverURL = process.env.TEST_SERVER_URL || "http://localhost:8080";

const DISABLE_HMR = !!process.env.DISABLE_HMR;
const bunFlags = [
  `--origin=${serverURL}`,
  DISABLE_HMR && "--disable-hmr",
].filter(Boolean);
const bunExec = process.env.BUN_BIN || "bun";
const bunProcess = child_process.spawn(bunExec, bunFlags, {
  cwd: snippetsDir,
  stdio: "pipe",

  shell: false,
});
console.log("$", bunExec, bunFlags.join(" "));
const isDebug = bunExec.endsWith("-debug");

bunProcess.stderr.pipe(process.stderr);
bunProcess.stdout.pipe(process.stdout);
bunProcess.once("error", (err) => {
  console.error("❌ bun error", err);
  process.exit(1);
});
process.on("beforeExit", () => {
  bunProcess?.kill(0);
});

function writeSnapshot(name, code) {
  let file = path.join(__dirname, "../snapshots", name);

  if (!DISABLE_HMR) {
    file =
      file.substring(0, file.length - path.extname(file).length) +
      ".hmr" +
      path.extname(file);
  }

  if (!fs.existsSync(path.dirname(file))) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  fs.writeFileSync(
    isDebug
      ? file.substring(0, file.length - path.extname(file).length) +
          ".debug" +
          path.extname(file)
      : file,
    code
  );
}

async function main() {
  const browser = await puppeteer.launch();
  const promises = [];
  let allTestsPassed = true;

  async function runPage(key) {
    var page;
    try {
      page = await browser.newPage();
      page.on("console", (obj) =>
        console.log(`[console.${obj.type()}] ${obj.text()}`)
      );
      page.exposeFunction("testFail", (error) => {
        console.log(`❌ ${error}`);
        allTestsPassed = false;
      });
      let testDone = new Promise((resolve) => {
        page.exposeFunction("testDone", resolve);
      });
      await page.goto(`${serverURL}/`, {
        waitUntil: "domcontentloaded",
      });
      await page.evaluate(`
        globalThis.runTest("${key}");
      `);
      await testDone;

      console.log(`✅ ${key}`);
    } catch (e) {
      allTestsPassed = false;
      console.log(`❌ ${key}: ${(e && e.message) || e}`);
    } finally {
      try {
        const code = await page.evaluate(`
         globalThis.getModuleScriptSrc("${key}");
      `);
        writeSnapshot(key, code);
      } catch (exception) {
        console.warn(`Failed to update snapshot: ${key}`, exception);
      }
    }

    await page.close();
  }

  const tests = [
    "/cjs-transform-shouldnt-have-static-imports-in-cjs-function.js",
    "/bundled-entry-point.js",
    "/export.js",
    "/type-only-imports.ts",
    "/global-is-remapped-to-globalThis.js",
    "/multiple-imports.js",
    "/ts-fallback-rewrite-works.js",
    "/tsx-fallback-rewrite-works.js",
    "/lodash-regexp.js",
    "/unicode-identifiers.js",
    "/string-escapes.js",
    "/package-json-exports/index.js",
    "/array-args-with-default-values.js",
    "/forbid-in-is-correct.js",
    "/code-simplification-neql-define.js",
    "/spread_with_key.tsx",
    "/styledcomponents-output.js",
    "/void-shouldnt-delete-call-expressions.js",
  ];
  tests.reverse();

  for (let test of tests) {
    await runPage(test);
  }

  await browser.close();
  bunProcess.kill(0);

  if (!allTestsPassed) {
    console.error(`❌ browser test failed`);
    process.exit(1);
  } else {
    console.log(`✅ browser test passed`);
    bunProcess.kill(0);
    process.exit(0);
  }
}

main().catch((error) =>
  setTimeout(() => {
    throw error;
  })
);
