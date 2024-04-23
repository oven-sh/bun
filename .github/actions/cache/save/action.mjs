import { saveCache } from "../action.mjs";

async function main() {
  await saveCache();
}

main().catch(error => {
  console.error("Failed to save cache:", error);
  process.exit(1);
});
