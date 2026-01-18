// Benchmark JSONL parsing performance without file I/O overhead
import { bench, group, run } from "mitata";

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

function generateJSONLContent(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(JSON.stringify(generateRecord(i)));
  }
  return lines.join("\n") + "\n";
}

// TypeScript implementation using Blob.text()
async function parseJSONLWithText<T>(blob: Blob): Promise<T[]> {
  const content = await blob.text();
  if (!content.trim()) return [];

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
}

// Native Bun.file().jsonl() equivalent via Blob
async function parseJSONLNative<T>(blob: Blob): Promise<T[]> {
  return (blob as any).jsonl();
}

// Sync-like TypeScript implementation (text is already available)
function parseJSONLSync<T>(content: string): T[] {
  if (!content.trim()) return [];

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
}

async function runBenchmarks() {
  const sizes = [100, 1000, 10000, 100000];

  for (const size of sizes) {
    const content = generateJSONLContent(size);
    const blob = new Blob([content]);

    // Pre-warm the blob text for sync comparison
    const textContent = await blob.text();

    group(`JSONL parsing ${size} lines (in-memory)`, () => {
      bench("Blob.jsonl() [native]", async () => {
        // Create new blob each time to avoid caching effects
        const b = new Blob([content]);
        await parseJSONLNative(b);
      });

      bench("Blob.text() + JS parse", async () => {
        const b = new Blob([content]);
        await parseJSONLWithText(b);
      });

      bench("String split + JSON.parse (sync)", () => {
        parseJSONLSync(textContent);
      });
    });
  }

  // Test with varying line lengths
  group("JSONL with large objects (1000 lines)", () => {
    const largeObjects = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `User_${i}`,
      description: "A".repeat(500), // 500 char string
      metadata: {
        key1: "value1",
        key2: "value2",
        key3: "value3",
        nested: { a: 1, b: 2, c: 3 },
      },
    }));
    const content = largeObjects.map(o => JSON.stringify(o)).join("\n") + "\n";
    const textContent = content;

    bench("Blob.jsonl() [native]", async () => {
      const b = new Blob([content]);
      await parseJSONLNative(b);
    });

    bench("Blob.text() + JS parse", async () => {
      const b = new Blob([content]);
      await parseJSONLWithText(b);
    });

    bench("String split + JSON.parse (sync)", () => {
      parseJSONLSync(textContent);
    });
  });

  await run();
}

runBenchmarks().catch(console.error);
