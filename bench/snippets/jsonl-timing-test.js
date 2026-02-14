// Test script for JSONL timing
const fs = require("fs");
const path = require("path");

const testDir = path.join(__dirname, ".jsonl-bench-data");

// Create test data if it doesn't exist
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });

  const sizes = [1000, 10000, 100000];
  for (const size of sizes) {
    const lines = [];
    for (let i = 0; i < size; i++) {
      lines.push(
        JSON.stringify({
          id: i,
          name: `User_${i}`,
          email: `user${i}@example.com`,
          timestamp: Date.now(),
          data: { key: `key_${i}`, value: i * 100 },
        }),
      );
    }
    fs.writeFileSync(path.join(testDir, `data-${size}.jsonl`), lines.join("\n") + "\n");
    console.log(`Created data-${size}.jsonl`);
  }
}

// Run tests
async function main() {
  const sizes = [1000, 10000, 100000];

  for (const size of sizes) {
    const filePath = path.join(testDir, `data-${size}.jsonl`);
    console.log(`\n>>> Testing ${size} lines...`);

    const result = await Bun.file(filePath).jsonl();
    console.log(`Result: ${result.length} items parsed`);
  }
}

main().catch(console.error);
