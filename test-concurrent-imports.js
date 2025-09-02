import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleUrl = join(__dirname, "test-module.js");

async function loadDynamicModule(importIndex) {
  try {
    console.log(`🚀 Starting import ${importIndex}`);
    const module = await import(moduleUrl);
    console.log(`✅ Import ${importIndex} completed`);

    try {
      console.log(`✅ Access ${importIndex}:`, Object.keys(module));
    } catch (err) {
      console.error(`❌ Access ${importIndex} failed:`, err.message);
    }
  } catch (error) {
    console.error(`❌ Import ${importIndex} failed:`, error.message);
  }
}

try {
  const imports = Array.from({ length: 5 }, (_, i) => {
    const importIndex = i + 1;
    return loadDynamicModule(importIndex);
  });

  await Promise.all(imports);
} catch (error) {
  console.error("❌ Test failed:", error);
}