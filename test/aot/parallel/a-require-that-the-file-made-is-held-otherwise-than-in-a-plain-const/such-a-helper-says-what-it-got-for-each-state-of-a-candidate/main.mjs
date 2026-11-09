import { createRequire } from "node:module";
function see(moduleUrl, candidates) {
  const require = createRequire(moduleUrl);
  for (const candidate of candidates)
    try {
      const got = require(candidate);
      console.log("SAID", candidate, typeof got, JSON.stringify(got));
    } catch {
      console.log("SAID", candidate, "threw");
    }
}
see(import.meta.url, ["./there.json", "./nothing.json", "./blank.json", "./mark.json", "./broken.json", "./null.json", "./list.json"]);
