import { saveCache } from "../action.mjs";

async function main() {
  try {
    const ok = await saveCache();
    if (ok) {
      console.log("Cache saved");
      return;
    }
  } catch (error) {
    console.error("Failed to restore cache:", error);
  }
  process.exit(1);
}

main();
