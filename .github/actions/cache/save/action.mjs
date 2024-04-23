import { saveCache } from "../action.mjs";

async function main() {
  const saved = await saveCache();
  if (saved) {
    console.log("Cache saved");
  } else {
    process.exit(1);
  }
}

main().catch(error => {
  console.error("Failed to save cache:", error);
  process.exit(1);
});
