import { getCommit, getSecret } from "../../scripts/utils.mjs";

console.log("Submitting...");
const response = await fetch(getSecret("BENCHMARK_URL") + "?tag=_&commit=" + getCommit() + "&artifact_url=_", {
  method: "POST",
});
console.log("Got status " + response.status);
