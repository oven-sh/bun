import { mkdirSync, writeFileSync } from "fs";
import path, { dirname, join } from "path";

const options: RequestInit = {};

if (process.env.GITHUB_TOKEN) {
  options.headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  };
}

async function fetchNodeTest(testName: string) {
  const nodeRepoUrl = "https://raw.githubusercontent.com/nodejs/node/main";
  const extensions = ["js", "mjs", "ts"];
  const testDirs = ["test/parallel", "test/sequential"];

  // Try different combinations of test name patterns
  const testNameVariations = [
    testName,
    testName.startsWith("test-") ? testName : `test-${testName}`,
    testName.replace(/^test-/, ""),
  ];

  for (const testDir of testDirs) {
    for (const nameVariation of testNameVariations) {
      // Try with extensions
      for (const ext of extensions) {
        const testPath = `${testDir}/${nameVariation}.${ext}`;
        const url = `${nodeRepoUrl}/${testPath}`;

        try {
          console.log(`Trying: ${url}`);
          const response = await fetch(url, options);
          if (response.ok) {
            const content = await response.text();
            const localPath = join("test/js/node", testPath);

            // Create directory if it doesn't exist
            mkdirSync(dirname(localPath), { recursive: true });

            // Write the file
            writeFileSync(localPath, content);
            console.log(
              `✅ Successfully fetched and saved: ${localPath} (${new Intl.NumberFormat("en-US", {
                notation: "compact",
                unit: "kilobyte",
              }).format(Buffer.byteLength(content, "utf-8"))})`,
            );
            return localPath;
          }
        } catch (error) {
          // Continue to next variation
        }
      }

      // Try without extension
      const testPath = `${testDir}/${nameVariation}`;
      const url = `${nodeRepoUrl}/${testPath}`;

      try {
        console.log(`Trying: ${url}`);
        const response = await fetch(url, options);
        if (response.ok) {
          const content = await response.text();
          const localPath = join("test/js/node", testPath);

          // Create directory if it doesn't exist
          mkdirSync(dirname(localPath), { recursive: true });

          // Write the file
          writeFileSync(localPath, content);
          console.log(
            `✅ Successfully fetched and saved: ${localPath} (${new Intl.NumberFormat("en-US", {
              notation: "compact",
              unit: "kilobyte",
            }).format(Buffer.byteLength(content, "utf-8"))})`,
          );
          return localPath;
        }
      } catch (error) {
        // Continue to next variation
      }
    }
  }

  throw new Error(`❌ Could not find test: ${testName}`);
}

// Get test name from command line arguments
let testName = process.argv[2];

if (testName.startsWith(path.join(import.meta.dirname, ".."))) {
  testName = testName.slice(path.join(import.meta.dirname, "..").length);
}

if (testName.startsWith("test/parallel/")) {
  testName = testName.replace("test/parallel/", "");
} else if (testName.startsWith("test/sequential/")) {
  testName = testName.replace("test/sequential/", "");
}

if (!testName) {
  console.error("Usage: bun scripts/fetch-node-test.ts <test-name>");
  process.exit(1);
}

try {
  await fetchNodeTest(testName);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
