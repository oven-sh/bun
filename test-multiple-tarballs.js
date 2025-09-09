// Test script to reproduce the multiple tarball deduplication bug
import { serve } from "bun";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

// Create test directory
const testDir = join(tmpdir(), `bun-test-${Date.now()}`);
mkdirSync(testDir, { recursive: true });

// Create multiple scoped package tarballs
const packages = [
  { name: "@test/package-a", version: "1.0.0" },
  { name: "@test/package-b", version: "1.0.0" },
  { name: "@test/package-c", version: "1.0.0" },
];

const tarballs = [];

for (const pkg of packages) {
  const pkgDir = join(testDir, pkg.name.replace("/", "-"));
  mkdirSync(pkgDir, { recursive: true });
  
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: pkg.name,
      version: pkg.version,
      main: "index.js",
    })
  );
  
  writeFileSync(
    join(pkgDir, "index.js"),
    `module.exports = "${pkg.name}";`
  );
  
  const tarballName = `${pkg.name.replace("/", "-")}-${pkg.version}.tgz`;
  execSync(`tar -czf ${join(testDir, tarballName)} -C ${pkgDir} .`);
  tarballs.push(tarballName);
}

// Create parent package that depends on all tarballs
const parentPkgDir = join(testDir, "parent-package");
mkdirSync(parentPkgDir, { recursive: true });

// Start a simple HTTP server to serve the tarballs
const server = serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    const filename = url.pathname.slice(1);
    
    if (tarballs.includes(filename)) {
      const content = readFileSync(join(testDir, filename));
      return new Response(content, {
        headers: {
          "Content-Type": "application/gzip",
        },
      });
    }
    
    return new Response("Not found", { status: 404 });
  },
});

const serverUrl = `http://localhost:${server.port}`;

// Create package.json with all tarball dependencies
writeFileSync(
  join(parentPkgDir, "package.json"),
  JSON.stringify({
    name: "parent-package",
    version: "1.0.0",
    dependencies: {
      "@test/package-a": `${serverUrl}/${tarballs[0]}`,
      "@test/package-b": `${serverUrl}/${tarballs[1]}`,
      "@test/package-c": `${serverUrl}/${tarballs[2]}`,
    },
  }, null, 2)
);

console.log(`Test directory: ${parentPkgDir}`);
console.log(`Server URL: ${serverUrl}`);
console.log("\nPackage.json:");
console.log(readFileSync(join(parentPkgDir, "package.json"), "utf-8"));

// Run bun install
console.log("\n=== Running bun install ===");
try {
  const result = execSync("bun install", {
    cwd: parentPkgDir,
    encoding: "utf-8",
    stdio: "pipe",
  });
  console.log(result);
  console.log("✅ Install succeeded!");
} catch (err) {
  console.error("❌ Install failed:");
  console.error("stdout:", err.stdout);
  console.error("stderr:", err.stderr);
  process.exit(1);
}

// Verify all packages were installed
console.log("\n=== Verifying installation ===");
for (const pkg of packages) {
  const modulePath = join(parentPkgDir, "node_modules", ...pkg.name.split("/"));
  try {
    const pkgJson = JSON.parse(readFileSync(join(modulePath, "package.json"), "utf-8"));
    console.log(`✅ ${pkg.name} installed (version: ${pkgJson.version})`);
  } catch (err) {
    console.error(`❌ ${pkg.name} NOT installed!`);
    process.exit(1);
  }
}

console.log("\n✅ All packages installed correctly!");
server.stop();
process.exit(0);