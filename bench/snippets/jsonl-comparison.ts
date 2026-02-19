// Benchmark comparing Bun.file().jsonl() vs TypeScript implementation
import { bench, group, run } from "mitata";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// User's TypeScript implementation
const UTF8_BOM = "\ufeff";

function stripBOM(content: string): string {
  return content.startsWith(UTF8_BOM) ? content.slice(1) : content;
}

async function readJSONLFile<T>(filePath: string): Promise<T[]> {
  try {
    let content = await readFile(filePath, "utf8");
    if (!content.trim()) return [];

    // Strip BOM from the beginning of the file - PowerShell 5.x adds BOM to UTF-8 files
    content = stripBOM(content);

    return content
      .split("\n")
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as T;
        } catch (err) {
          console.error(`Error parsing line in ${filePath}: ${err}`);
          return null;
        }
      })
      .filter((entry): entry is T => entry !== null);
  } catch (err) {
    console.error(`Error opening file ${filePath}: ${err}`);
    return [];
  }
}

async function readJSONLFileBunJSONL<T>(filePath: string): Promise<T[]> {
  const result = await Bun.file(filePath).jsonl();
  return result;
}

// Alternative TypeScript implementation using Bun.file().text()
async function readJSONLFileBunText<T>(filePath: string): Promise<T[]> {
  try {
    let content = await Bun.file(filePath).text();
    if (!content.trim()) return [];

    content = stripBOM(content);

    return content
      .split("\n")
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as T;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is T => entry !== null);
  } catch {
    return [];
  }
}

// Setup test data directory
const BENCH_DIR = path.join(import.meta.dir, ".jsonl-bench-data");

interface TestRecord {
  id: number;
  name: string;
  email: string;
  timestamp: number;
  data: { key: string; value: number };
}

function generateRecord(i: number): TestRecord {
  return {
    id: i,
    name: `User_${i}`,
    email: `user${i}@example.com`,
    timestamp: Date.now(),
    data: { key: `key_${i}`, value: i * 100 },
  };
}

async function setup() {
  await mkdir(BENCH_DIR, { recursive: true });

  // Generate test files of various sizes
  const sizes = [10, 100, 1000, 10000, 100000];

  for (const size of sizes) {
    const lines: string[] = [];
    for (let i = 0; i < size; i++) {
      lines.push(JSON.stringify(generateRecord(i)));
    }
    await writeFile(path.join(BENCH_DIR, `data-${size}.jsonl`), lines.join("\n") + "\n");
  }

  // File with BOM
  const bomContent = "\ufeff" + [0, 1, 2].map(i => JSON.stringify(generateRecord(i))).join("\n") + "\n";
  await writeFile(path.join(BENCH_DIR, "data-bom.jsonl"), bomContent);

  // File with empty lines and invalid JSON
  const mixedContent = [
    JSON.stringify(generateRecord(0)),
    "",
    "   ",
    "invalid json here",
    JSON.stringify(generateRecord(1)),
    "\t\t",
    JSON.stringify(generateRecord(2)),
  ].join("\n");
  await writeFile(path.join(BENCH_DIR, "data-mixed.jsonl"), mixedContent);

  // File with CRLF
  const crlfContent = [0, 1, 2].map(i => JSON.stringify(generateRecord(i))).join("\r\n") + "\r\n";
  await writeFile(path.join(BENCH_DIR, "data-crlf.jsonl"), crlfContent);

  console.log("Setup complete. Test files created in:", BENCH_DIR);
}

async function cleanup() {
  await rm(BENCH_DIR, { recursive: true, force: true });
}

async function runBenchmarks() {
  await setup();

  const sizes = [10, 100, 1000, 10000, 100000];

  for (const size of sizes) {
    const filePath = path.join(BENCH_DIR, `data-${size}.jsonl`);

    group(`JSONL parsing (${size} lines)`, () => {
      bench("Bun.file().jsonl() [native]", async () => {
        await readJSONLFileBunJSONL(filePath);
      });

      bench("readJSONLFile (node:fs)", async () => {
        await readJSONLFile(filePath);
      });

      bench("readJSONLFile (Bun.file)", async () => {
        await readJSONLFileBunText(filePath);
      });
    });
  }

  // Edge cases
  group("Edge cases - BOM handling", () => {
    const filePath = path.join(BENCH_DIR, "data-bom.jsonl");

    bench("Bun.file().jsonl() [native]", async () => {
      await readJSONLFileBunJSONL(filePath);
    });

    bench("readJSONLFile (node:fs)", async () => {
      await readJSONLFile(filePath);
    });
  });

  await run();
  await cleanup();
}

runBenchmarks().catch(console.error);
