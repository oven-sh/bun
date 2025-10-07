import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const MODULES_DIR = join(process.cwd(), "modules");
const NUM_MODULES = 1000;

// Create the modules directory if it doesn't exist
async function ensureModulesDir() {
  try {
    await mkdir(MODULES_DIR, { recursive: true });
    console.log(`Created directory: ${MODULES_DIR}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err;
    }
  }
}

const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Hot Reload Stress Test</title>
  <script src="./client_1.js"></script>
</head>
<body>
  <h1>Hot Reload Stress Test</h1>
</body>
</html>
`;

// Generate the HTTP server file (the last file)
async function generateServerFile() {
  const content = `
// File: module_${NUM_MODULES}.ts
console.log("Server module loaded");
import html from './index.html';

// Create a server to prove things are running
const server = Bun.serve({
  port: 0,
  routes: {
    "/": html,
  },
  fetch() {
    return new Response("Hot reload stress test server running");
  },
});

if (process.send) {
  process.send({
    type: "server-started",
    url: server.url.href,
  });
}

console.log(\`Server started on http://localhost:\${server.port}\`);

// Print RSS memory usage
const rss = process.memoryUsage().rss / 1024 / 1024;
console.log(\`RSS Memory: \${rss.toFixed(2)} MB\`);
`;

  await writeFile(join(MODULES_DIR, `module_${NUM_MODULES}.ts`), content);
}

// Generate interconnected module files
async function generateModuleFiles() {
  // Generate modules 1 through NUM_MODULES-1
  for (let i = 1; i < NUM_MODULES; i++) {
    // Each module imports 2 other modules (except for the ones near the end that need to import the server)
    const importIdx1 = Math.min(i + 1, NUM_MODULES);
    const importIdx2 = Math.min(i + 2, NUM_MODULES);

    const content = `
// File: module_${i}.ts
import "./module_${importIdx1}";
import "./module_${importIdx2}";

// This value will be changed during hot reload stress testing
export const value${i} = {
  moduleId: ${i},
  timestamp: \`\${new Date().toISOString()}\`,
  counter: 0
};

`;

    await writeFile(join(MODULES_DIR, `module_${i}.ts`), content);

    if (i % 100 === 0) {
      console.log(`Generated ${i} modules`);
    }
  }
}

// Generate the entry point file
async function generateEntryPoint() {
  const content = `

if (!globalThis.hasLoadedOnce) {
globalThis.hasLoadedOnce = true;
console.log("Starting hot-reload stress test...");

// Print RSS memory usage
const rss = process.memoryUsage().rss / 1024 / 1024;
console.log(\`RSS Memory: \${rss.toFixed(2)} MB\`);

// Signal when the entry point is loaded
if (process.send && process.env.HOT_RELOAD_TEST === "true") {
  process.send({
    type: 'test-started',
    rss: rss.toFixed(2)
  });
}

// Print memory usage periodically
setInterval(() => {
  const rss = process.memoryUsage().rss / 1024 / 1024;
  console.log(\`[MEMORY] RSS: \${rss.toFixed(2)} MB at \${new Date().toISOString()}\`);
  
  // Also send via IPC if available
  if (process.send && process.env.HOT_RELOAD_TEST === "true") {
    process.send({
      type: 'memory-update',
      rss: rss.toFixed(2),
      time: Date.now()
    });
  }
}, 5000);
}

await import("./module_1");

process.send({
  type: "module-reloaded",
  rss: (process.memoryUsage.rss() / 1024 / 1024) | 0,
});


`;

  await writeFile(join(MODULES_DIR, "index.ts"), content);
}

async function generateClientFile() {
  const content = `
// File: client_1.js
console.log("Client module loaded");
`;
  await writeFile(join(MODULES_DIR, "client_1.js"), content);
  await writeFile(join(MODULES_DIR, "index.html"), html);
  console.log("Generated client module");
}

await ensureModulesDir();
console.log("Generating server module...");
await generateServerFile();
console.log("Generating client module...");
await generateClientFile();
console.log("Generating interconnected modules...");
await generateModuleFiles();
console.log("Generating entry point...");
await generateEntryPoint();
console.log("Generation complete!");
console.log("Run with: HOT_RELOAD_TEST=true RELOAD_ID=initial bun --hot modules/index.ts");
