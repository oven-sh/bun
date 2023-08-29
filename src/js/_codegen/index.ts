const [major, minor] = Bun.version
  .split("_")[0]
  .split(".")
  .map(x => parseInt(x));

if (minor < 8) {
  console.error("Please install bun >= 0.8.0");
  process.exit(1);
}

import "./build-modules";
import "./build-functions";
