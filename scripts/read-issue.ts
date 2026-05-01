const body = process.env.GITHUB_ISSUE_BODY;

if (!body) {
  throw new Error("GITHUB_ISSUE_BODY must be set");
}

const labels: string[] = [];
let command = "";
if (body.includes("[TestCommand]")) {
  command = "jest";
} else if (body.includes("[BuildCommand]")) {
  command = "bundler";
} else if (body.includes("[InstallCommand]") || body.includes("[AddCommand]") || body.includes("[RemoveCommand]")) {
  command = "npm";
}

let featuresLine = "";
const featuresI = body.indexOf("\nFeatures: ");
const featuresEndI = body.indexOf("\n", featuresI + 1);
if (featuresI > -1 && featuresEndI > -1) {
  featuresLine = body.slice(featuresI + 1, featuresEndI).trim();
}

const features = featuresLine.split(" ").map(a => a.trim().toLowerCase());

if (features.includes("jsc")) {
  labels.push("runtime");
}

if (features.includes("shell")) {
  labels.push("shell");
}

const lines = body.split("\n");
for (const line of lines) {
  if (line.startsWith("Bun v") && line.includes(" on ")) {
    const onI = line.indexOf(" on ");
    const onI2 = line.indexOf("\n", onI + 1);
    const on = line
      .slice(onI + 4, onI2 > -1 ? onI2 : undefined)
      .trim()
      .toLowerCase();

    if (on.includes("macos") || on.includes("darwin")) {
      labels.push("macos");
    } else if (on.includes("linux")) {
      labels.push("linux");
    } else if (on.includes("windows") || on.includes("nt")) {
      labels.push("windows");
    }
  }
}

if (labels.length > 0) {
  console.write(labels.join(",") + "\n");
}
