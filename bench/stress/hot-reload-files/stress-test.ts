import { Subprocess } from "bun";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const MODULES_DIR = join(process.cwd(), "modules");
const NUM_MODULES = 1000;
const TOTAL_RELOADS = 1000;

// Tracking metrics
let completedReloads = 0;
let startTime = 0;
let lastRss = 0;

// Function to write modified files
async function modifyFile(moduleNum: number, reloadId: string): Promise<void> {
  const modulePath = join(MODULES_DIR, `module_${moduleNum}.ts`);

  try {
    // Read the current file content
    const content = await readFile(modulePath, "utf8");

    // Create a new timestamp
    const timestamp = new Date().toISOString();

    // Replace the timestamp and counter
    const newContent = content.replace(
      /export const value\d+ = \{[\s\S]*?\};/,
      `export const value${moduleNum} = {
  moduleId: ${moduleNum},
  timestamp: "${timestamp}",
  // comment ${completedReloads}!
  counter: ${completedReloads + 1}
};

`,
    );

    // Write the modified content back to the file
    await writeFile(modulePath, newContent);
    console.count("Modify");
    return;
  } catch (error) {
    console.error(`Error modifying module_${moduleNum}.ts:`, error);
    throw error;
  }
}

// Get a random number between min and max (inclusive)
function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Start the child process with Bun's hot reloading
function startBunProcess() {
  // Start the Bun process with hot reloading enabled
  const child = Bun.spawn({
    cmd: [process.execPath, "--hot", "--no-clear-screen", "./modules/index.ts"],
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      HOT_RELOAD_TEST: "true",
      RELOAD_ID: "initial",
    },
    ipc(message, subprocess) {
      if (message.type === "test-started") {
        console.log(`Test started with initial RSS: ${message.rss} MB`);
        lastRss = parseFloat(message.rss);
        startNextReload();
      } else if (message.type === "module-reloaded") {
        const { rss } = message;
        lastRss = parseFloat(rss);

        // Check if this is the current reload we're waiting for
        completedReloads++;
        console.log(`[${completedReloads}/${TOTAL_RELOADS}] Module reloaded - RSS: ${rss} MB`);

        // Start the next reload or finish
        if (completedReloads < TOTAL_RELOADS) {
          startNextReload();
        } else {
          finishTest();
        }
      } else if (message.type === "memory-update") {
        // Periodic memory updates from the child process
        lastRss = parseFloat(message.rss);
      } else if (message.type === "server-started") {
        fetch(message.url).then(res => {
          res.text().then(text => {
            console.count("Request completed");
          });
        });
      }
    },
  });

  return child;
}

// Start the next reload
async function startNextReload() {
  const nextReloadNum = completedReloads + 1;
  if (nextReloadNum > TOTAL_RELOADS) return;

  try {
    // Generate a unique reload ID for this reload
    const reloadId = `reload-${nextReloadNum}`;

    // Set the reload ID in the environment for the child process
    process.env.RELOAD_ID = reloadId;

    // Pick a random module to modify
    const moduleNum = getRandomInt(1, NUM_MODULES - 1);

    // Modify the file to trigger a hot reload
    await modifyFile(moduleNum, reloadId);
  } catch (error) {
    console.error(`Error during reload #${nextReloadNum}:`, error);
    // Try the next reload immediately
    startNextReload();
  }
}

// Finish the test and print statistics
function finishTest() {
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;

  console.log(`\nStress test complete!`);
  console.log(`Performed ${completedReloads} hot reloads in ${duration.toFixed(2)} seconds`);
  console.log(`Average: ${((duration / completedReloads) * 1000).toFixed(2)} ms per reload`);
  console.log(`Final RSS: ${lastRss.toFixed(2)} MB`);

  // Kill the child process and exit immediately
  if (childProcess) {
    childProcess.kill();
  }
  process.exit(0);
}

// Run the stress test
let childProcess: Subprocess | null = null;

async function runStressTest() {
  console.log(`Starting stress test - will perform ${TOTAL_RELOADS} hot reloads`);
  startTime = Date.now();

  // Start the Bun process with hot reloading
  childProcess = startBunProcess();
}

// Start the stress test
runStressTest();

// Handle process termination
process.on("SIGINT", () => {
  console.log("\nTest interrupted by user");
  if (childProcess) {
    childProcess.kill();
  }
  process.exit(1);
});
