import { readdir } from "node:fs/promises";
import { join } from "node:path";

const allDotTsFiles: string[] = [];
export const getDotTsFiles = async (
  prefix = "",
  folder: string = join(import.meta.dir, "..", ".."),
  folderName?: string,
) => {
  const files = await readdir(folder, { withFileTypes: true });
  for await (const file of files) {
    if (
      file.isDirectory() &&
      (file.name === "node_modules" || file.name === "tests")
    )
      continue;

    if (file.isDirectory())
      await getDotTsFiles(prefix, join(folder, file.name), file.name);
    else if (file.name.endsWith(".d.ts"))
      allDotTsFiles.push(prefix + join(folderName || "", file.name));
  }

  return allDotTsFiles;
};
