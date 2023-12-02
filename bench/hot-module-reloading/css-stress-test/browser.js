const puppeteer = require("puppeteer");
const http = require("http");
const path = require("path");
const url = require("url");
const fs = require("fs");
const child_process = require("child_process");
const serverURL = process.env.TEST_SERVER_URL || "http://localhost:8080";

if (process.env.PROJECT === "bun") {
  const bunFlags = [`--origin=${serverURL}`].filter(Boolean);
  const bunExec = process.env.BUN_BIN || "bun";
  const bunProcess = child_process.spawn(bunExec, bunFlags, {
    cwd: process.cwd(),
    stdio: "ignore",
    env: {
      ...process.env,
      DISABLE_BUN_ANALYTICS: "1",
    },

    shell: false,
  });
  console.log("$", bunExec, bunFlags.join(" "));
  const isDebug = bunExec.endsWith("-debug");

  // bunProcess.stderr.pipe(process.stderr);
  // bunProcess.stdout.pipe(process.stdout);
  bunProcess.once("error", err => {
    console.error("❌ bun error", err);
    process.exit(1);
  });
  process.on("beforeExit", () => {
    bunProcess?.kill(0);
  });
} else if (process.env.PROJECT === "next") {
  const bunProcess = child_process.spawn("./node_modules/.bin/next", ["--port", "8080"], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: {
      ...process.env,
    },

    shell: false,
  });
}

const delay = new Promise((resolve, reject) => {
  const watcher = fs.watch(path.resolve(process.cwd(), "src/colors.css.blob"));
  watcher.once("change", () => {
    setTimeout(() => {
      resolve();
    }, 1000);
  });
});

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    waitForInitialPage: true,
    args: [
      `--window-size=${parseInt(process.env.SCREEN_WIDTH || "1024", 10) / 2},${
        parseInt(process.env.SCREEN_HEIGHT || "1024", 10) / 2
      }`,
    ],
    defaultViewport: {
      width: parseInt(process.env.SCREEN_WIDTH || "1024", 10) / 2,
      height: parseInt(process.env.SCREEN_HEIGHT || "1024", 10) / 2,
    },
  });
  const promises = [];
  let allTestsPassed = true;

  async function runPage(key) {
    var page;

    try {
      console.log("Opening page");
      page = await browser.newPage();

      console.log(`Navigating to "http://localhost:8080/"`);

      while (true) {
        try {
          await page.goto("http://localhost:8080/", { waitUntil: "load" });
          break;
        } catch (exception) {
          if (!exception.toString().includes("ERR_CONNECTION_REFUSED")) break;
        }
      }

      await page.bringToFront();

      await delay;

      //   runner.stdout.pipe(process.stdout);
      //   runner.stderr.pipe(process.stderr);
      var didResolve = false;

      console.log(`Completed. Done.`);
    } catch (error) {
      console.error(error);
    } finally {
      await page.close();
      await browser.close();
    }
  }

  return runPage();
}

main().catch(error =>
  setTimeout(() => {
    throw error;
  }),
);
