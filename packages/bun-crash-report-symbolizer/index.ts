import { which } from "bun";

const symbolizerPath = ["llvm-symbolizer-13", "llvm-symbolizer"].find((a) =>
  which(a),
);

if (!symbolizerPath) {
  throw new Error("llvm-symbolizer not found in $PATH");
}

export const symbolizer = symbolizerPath;

function readCrashReport(text: string) {
  const lines = text
    .split("\n")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  const metaOffset = lines.findIndex((a) => a.includes(" bun meta "));
  let lastMetaLine = metaOffset + 1;
  for (; lastMetaLine < lines.length; lastMetaLine++) {
    const line = lines[lastMetaLine];
    if (line.includes(" bun meta ")) break;
  }

  const meta = lines.slice(metaOffset, lastMetaLine);
  console.log(metaOffset, lastMetaLine);
  const version = /v(\d+\.\d+\.\d+)/.exec(meta[0])?.[1];
  var stack = lines
    .slice(lastMetaLine + 1)
    .filter((a) => a.length > 0 && !a.includes("ask for"));

  return { version, stack };
}

console.log(
  readCrashReport(
    await Bun.file(
      "/Users/jarred/.bun/.bun-crash/v0.2.3-1668157348119.crash",
    ).text(),
  ),
);
