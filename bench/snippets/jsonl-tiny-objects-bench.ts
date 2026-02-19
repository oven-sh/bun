// Benchmark designed to maximize native implementation advantage
// Small JSON objects = minimal parse time, maximum boundary-crossing overhead ratio
import { bench, group, run } from "mitata";

// Generate tiny JSON objects - minimal parse time per object
function generateTinyJSONL(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(`{"i":${i}}`);
  }
  return lines.join("\n") + "\n";
}

// Even smaller - just numbers
function generateNumbersJSONL(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(String(i));
  }
  return lines.join("\n") + "\n";
}

// Small strings
function generateStringsJSONL(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(`"s${i}"`);
  }
  return lines.join("\n") + "\n";
}

// TypeScript implementation
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

// Native Blob.jsonl()
async function parseJSONLNative<T>(blob: Blob): Promise<T[]> {
  return (blob as any).jsonl();
}

async function runBenchmarks() {
  console.log("=== Native vs JS: Small Objects Benchmark ===");
  console.log("Goal: Maximize boundary-crossing overhead ratio\n");

  // Test with very high line counts and tiny objects
  const sizes = [10_000, 50_000, 100_000, 500_000, 1_000_000];

  // Tiny objects: {"i":N}
  for (const size of sizes) {
    const content = generateTinyJSONL(size);
    const sizeKB = (content.length / 1024).toFixed(1);

    group(`Tiny objects {"i":N} - ${size / 1000}k lines (${sizeKB} KB)`, () => {
      bench("Blob.jsonl() [native]", async () => {
        const b = new Blob([content]);
        await parseJSONLNative(b);
      });

      bench("Blob.text() + JS parse", async () => {
        const b = new Blob([content]);
        await parseJSONLWithText(b);
      });
    });
  }

  // Plain numbers - absolute minimum parse time
  const numberSizes = [100_000, 500_000, 1_000_000];
  for (const size of numberSizes) {
    const content = generateNumbersJSONL(size);
    const sizeKB = (content.length / 1024).toFixed(1);

    group(`Plain numbers - ${size / 1000}k lines (${sizeKB} KB)`, () => {
      bench("Blob.jsonl() [native]", async () => {
        const b = new Blob([content]);
        await parseJSONLNative(b);
      });

      bench("Blob.text() + JS parse", async () => {
        const b = new Blob([content]);
        await parseJSONLWithText(b);
      });
    });
  }

  // Small strings
  for (const size of numberSizes) {
    const content = generateStringsJSONL(size);
    const sizeKB = (content.length / 1024).toFixed(1);

    group(`Small strings "sN" - ${size / 1000}k lines (${sizeKB} KB)`, () => {
      bench("Blob.jsonl() [native]", async () => {
        const b = new Blob([content]);
        await parseJSONLNative(b);
      });

      bench("Blob.text() + JS parse", async () => {
        const b = new Blob([content]);
        await parseJSONLWithText(b);
      });
    });
  }

  await run();
}

runBenchmarks().catch(console.error);
