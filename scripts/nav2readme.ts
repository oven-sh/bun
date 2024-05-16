// Regenerate the Table of Contents in the README by reading through nav.ts
//
// To run this:
//
//   bun ./scripts/nav2readme.ts
//
//
import nav from "../docs/nav";
import { readdirSync } from "fs";
import path from "path";
function getQuickLinks() {
  let md = "";

  // This ordering is intentional
  for (const item of nav.items) {
    if (item.type === "divider") {
      md += "\n" + `- ${item.title}` + "\n";
    } else {
      md += `  - [${item.title}](https://bun.sh/docs/${item.slug})` + "\n";
    }
  }

  return md;
}

async function getGuides() {
  let md = "";
  const basePath = path.join(import.meta.dirname, "..", "docs/guides");
  const allGuides = readdirSync(basePath, { withFileTypes: true, recursive: true });
  const promises: Promise<{ name: string; file: string }>[] = [];
  for (const guide of allGuides) {
    if (guide.isFile() && guide.name.endsWith(".md")) {
      const joined = path.join(basePath, guide.name);
      promises.push(
        Bun.file(joined)
          .text()
          .then(text => {
            const nameI = text.indexOf("name: ");
            const name = text.slice(nameI + "name: ".length, text.indexOf("\n", nameI)).trim();
            return {
              name,
              file: guide.name,
            };
          }),
      );
    }
  }

  const files = await Promise.all(promises);
  md += "## Guides " + "\n";
  // The guides ordering is not as intentional
  // They should be grouped by category
  // and then by name within the category
  files.sort((a, b) => {
    const aDir = path.basename(path.dirname(a.file)).toLowerCase();
    const bDir = path.basename(path.dirname(b.file)).toLowerCase();
    let cmp = aDir.localeCompare(bDir);
    if (cmp !== 0) {
      return cmp;
    }

    return a.name.localeCompare(b.name);
  });

  let prevDirname = "";
  for (const { name, file } of files) {
    const dirname = path.basename(path.dirname(file));
    if (dirname !== prevDirname) {
      md += `\n- ${normalizeSectionName(dirname)} ` + "\n";
      prevDirname = dirname;
    }
    md +=
      `  - [${name}](https://bun.sh/guides/${path.dirname(file)}/${path.basename(file, path.extname(file))})` + "\n";
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

const guides = await getGuides();

const combined =
  [text.slice(0, start), getQuickLinks(), guides, text.slice(contributing)].map(text => text.trim()).join("\n\n") +
  "\n";

await Bun.write(Bun.fileURLToPath(import.meta.resolve("../README.md")), combined);

function normalizeSectionName(name: string) {
  if (name.includes("-")) {
    return name
      .split("-")
      .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s))
      .join(" ");
  }

  name = name.charAt(0).toUpperCase() + name.slice(1);
  name = name.replaceAll("Https", "HTTPS");
  name = name.replaceAll("Http", "HTTP");
  name = name.replaceAll("Websocket", "WebSocket");
  return name;
}
