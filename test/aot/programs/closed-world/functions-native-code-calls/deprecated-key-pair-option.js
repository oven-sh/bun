// generateKeyPairSync warns about the old names of two options.
import { generateKeyPairSync } from "node:crypto";
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
try {
  generateKeyPairSync("rsa-pss", { modulusLength: 1024, hash: "sha256", mgf1Hash: "sha256" });
  console.log("generated");
} catch (error) {
  console.log(error.message);
}
