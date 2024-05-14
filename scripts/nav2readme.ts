// Regenerate the Table of Contents in the README by reading through nav.ts
//
// To run this:
//
//   bun ./scripts/nav2readme.ts
//
//
import nav from "../docs/nav";

function getMarkdown() {
  let md = "";

  for (const item of nav.items) {
    if (item.type === "divider") {
      md += "\n" + `- ${item.title}` + "\n";
    } else {
      md += `  - [${item.title}](https://bun.sh/docs/${item.slug})` + "\n";
    }
  }

  return md;
}

const text = await Bun.file(Bun.fileURLToPath(import.meta.resolve("../README.md"))).text();
const startI = text.indexOf("## Quick links\n");
if (startI === -1) {
  throw new Error("Could not find ## Quick links in README");
}
const start = startI + "## Quick links\n".length;

const contributing = text.indexOf("## Contributing\n", start);

if (contributing === -1) {
  throw new Error("Could not find ## Contributing in README");
}

const combined =
  [text.slice(0, start), getMarkdown(), text.slice(contributing)].map(text => text.trim()).join("\n\n") + "\n";

await Bun.write(Bun.fileURLToPath(import.meta.resolve("../README.md")), combined);
