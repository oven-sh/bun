#!/usr/bin/env bun
import { readdirSync } from "fs";
import path from "path";

// Parse command line arguments
const args = process.argv.slice(2);

const filePaths = args.filter(arg => !arg.startsWith("-"));
const usage = String.raw`
                      __           .__                              __
 ____________________/  |_  _______|__| _____ ______   ____________/  |_  ______
 \___   /  _ \_  __ \   __\ \___   /  |/     \\____ \ /  _ \_  __ \   __\/  ___/
  /    (  <_> )  | \/|  |    /    /|  |  Y Y  \  |_> >  <_> )  | \/|  |  \___ \
 /_____ \____/|__|   |__|   /_____ \__|__|_|  /   __/ \____/|__|   |__| /____  >
       \/                         \/        \/|__|                           \/

Usage: bun scripts/sort-imports [options] <files...>

Options:
  --help         Show this help message
  --include-pub  Also sort ${"`pub`"} imports
  --keep-unused  Don't remove unused imports

Examples:
  bun scripts/sort-imports src
`.slice(1);
if (args.includes("--help")) {
  console.log(usage);
  process.exit(0);
}
if (filePaths.length === 0) {
  console.error(usage);
  process.exit(1);
}

const config = {
  includePub: args.includes("--include-pub"),
  removeUnused: !args.includes("--keep-unused"),
  normalizePaths: "./",
};

// Type definitions
type Declaration = {
  index: number;
  key: string;
  value: string;
  segments: string[] | null;
  whole: string;
  last?: string;
  wholepath?: string[];
};

// Parse declarations from the file
function parseDeclarations(
  lines: string[],
  fileContents: string,
): {
  declarations: Map<string, Declaration>;
  unusedLineIndices: number[];
} {
  const declarations = new Map<string, Declaration>();
  const unusedLineIndices: number[] = [];

  // for stability
  const sortedLineKeys = [...lines.keys()].sort((a, b) => (lines[a] < lines[b] ? -1 : lines[a] > lines[b] ? 1 : 0));

  for (const i of sortedLineKeys) {
    const line = lines[i];

    if (line === "// @sortImports") {
      lines[i] = DELETED_LINE;
      continue;
    }

    const inlineDeclPattern = /^(?:pub )?const ([a-zA-Z0-9_]+) = (.+);(\s*\/\/[^\n]*)?$/;
    const match = line.match(inlineDeclPattern);

    if (!match) continue;

    const name = match[1];
    const value = match[2];

    // Skip if the previous line has a doc comment
    const prevLine = lines[i - 1] ?? "";
    if (prevLine.startsWith("///")) {
      continue;
    }

    // Skip unused declarations (non-public declarations that appear only once)
    if (config.removeUnused && !line.includes("pub ")) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expectedCount = (line.match(new RegExp(`\\b${escapedName}\\b`, "g")) || []).length;
      const actualCount = (fileContents.match(new RegExp(`\\b${escapedName}\\b`, "g")) || []).length;
      if (expectedCount === actualCount) {
        // unused decl
        unusedLineIndices.push(i);
        continue;
      }
    }

    if (!config.includePub && line.includes("pub ")) {
      continue;
    }

    if (declarations.has(name)) {
      unusedLineIndices.push(i);
      continue;
    }
    declarations.set(name, {
      whole: line,
      index: i,
      key: name,
      value,
      segments: parseSegments(value),
    });
  }

  return { declarations, unusedLineIndices };
}

// Validate if a segment is a valid identifier
function isValidSegment(segment: string): boolean {
  if (segment.startsWith("@import(") || segment === "@This()") {
    return true;
  }
  return segment.match(/^[a-zA-Z0-9_]+$/) != null;
}

// Parse import path segments from a value
function parseSegments(value: string): null | string[] {
  if (value.startsWith("@import(")) {
    const rightBracketIndex = value.indexOf(")");
    if (rightBracketIndex === -1) return null;

    const importPart = value.slice(0, rightBracketIndex + 1);
    const remainingPart = value.slice(rightBracketIndex + 1);

    if (remainingPart.startsWith(".")) {
      const segments = remainingPart.slice(1).split(".");
      if (!segments.every(segment => isValidSegment(segment))) return null;
      return [importPart, ...segments];
    } else if (remainingPart === "") {
      return [importPart];
    } else {
      return null;
    }
  } else {
    const segments = value.split(".");
    if (!segments.every(segment => isValidSegment(segment))) return null;
    return segments;
  }
}

// Resolve the first segment of an import path
function resolveFirstSegment(firstSegment: string, declarations: Map<string, Declaration>): null | string[] {
  if (firstSegment.startsWith("@import(") || firstSegment.startsWith("@This()")) {
    return [firstSegment];
  } else {
    const declaration = declarations.get(firstSegment);
    if (!declaration) {
      return null; // Unknown declaration
    }

    const subFirstSegment = declaration.segments?.[0];
    if (!subFirstSegment) {
      return null; // Invalid declaration
    }

    const resolvedSubFirst = resolveFirstSegment(subFirstSegment, declarations);
    if (!resolvedSubFirst) {
      return null; // Unable to resolve
    }

    return [...resolvedSubFirst, ...(declaration.segments?.slice(1) ?? [])];
  }
}

type Group = {
  keySegments: string[];
  declarations: Declaration[];
};

// Group declarations by their import paths
function groupDeclarationsByImportPath(declarations: Map<string, Declaration>): Map<string, Group> {
  const groups = new Map<string, Group>();

  for (const declaration of declarations.values()) {
    if (!declaration.segments || declaration.segments.length < 1) {
      continue;
    }

    const firstSegment = declaration.segments[0];
    const resolvedFirst = resolveFirstSegment(firstSegment, declarations);

    if (!resolvedFirst) {
      continue;
    }

    const remainingSegments = declaration.segments.slice(1);
    const fullPath = [...resolvedFirst, ...remainingSegments];
    const lastSegment = fullPath.pop();

    if (!lastSegment) {
      continue;
    }

    const groupKey = fullPath.join(".");
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { keySegments: fullPath, declarations: [] });
    }

    groups.get(groupKey)!.declarations.push(declaration);
    declaration.last = lastSegment;
    declaration.wholepath = [...fullPath, lastSegment];
  }

  return groups;
}

// Merge single-item groups into their parent groups
function mergeSingleItemGroups(groups: Map<string, Group>): void {
  while (true) {
    let hasChanges = false;

    for (const [groupKey, group] of groups.entries()) {
      if (group.declarations.length === 1) {
        const gcsplit = [...group.keySegments];
        while (gcsplit.pop()) {
          const parentKey = gcsplit.join(".");
          if (groups.has(parentKey)) {
            groups.get(parentKey)!.declarations.push(group.declarations[0]);
            groups.delete(groupKey);
            hasChanges = true;
            break;
          }
        }
      }
    }

    if (!hasChanges) break;
  }
}

// Move items with child groups to the top of those child groups
function promoteItemsWithChildGroups(groups: Map<string, Group>): void {
  for (const [groupKey, group] of groups.entries()) {
    for (let i = 0; i < group.declarations.length; ) {
      const item = group.declarations[i];
      const childGroupKey = (groupKey ? groupKey + "." : "") + item.last;

      if (groups.has(childGroupKey)) {
        groups.get(childGroupKey)!.declarations.unshift(item);
        group.declarations.splice(i, 1);
      } else {
        i++;
      }
    }
  }
}

// Sort groups and their declarations
function sortGroupsAndDeclarations(groups: Map<string, Group>): string[] {
  // Sort declarations within each group
  for (const group of groups.values()) {
    group.declarations.sort((a, b) => {
      if (a.wholepath?.length !== b.wholepath?.length) {
        return (a.wholepath?.length ?? 0) - (b.wholepath?.length ?? 0);
      }
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  }

  // Sort group keys alphabetically
  return Array.from(groups.keys()).sort((a, b) => {
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// Generate the sorted output
function generateSortedOutput(lines: string[], groups: Map<string, Group>, sortedGroupKeys: string[]): string[] {
  const outputLines = [...lines];

  for (const groupKey of sortedGroupKeys) {
    const groupDeclarations = groups.get(groupKey)!;
    if (!groupDeclarations?.declarations.length) continue;

    // Add spacing between groups
    outputLines.push("");

    // Add declarations to output and mark original lines for removal
    for (const declaration of groupDeclarations.declarations) {
      outputLines.push(declaration.whole);
      outputLines[declaration.index] = DELETED_LINE;
    }
  }

  return outputLines;
}

function extractThisDeclaration(declarations: Map<string, Declaration>): Declaration | null {
  for (const declaration of declarations.values()) {
    if (declaration.value === "@This()") {
      declarations.delete(declaration.key);
      return declaration;
    }
  }
  return null;
}

const DELETED_LINE = "%DELETED_LINE%";

// Main execution function for a single file
async function processFile(filePath: string): Promise<void> {
  const originalFileContents = await Bun.file(filePath).text();
  let fileContents = originalFileContents;

  if (config.normalizePaths === "") {
    fileContents = fileContents.replaceAll(`@import("./`, `@import("`);
  } else if (config.normalizePaths === "./") {
    fileContents = fileContents.replaceAll(/@import\("([A-Za-z0-9_-][^"]*\.zig)"\)/g, '@import("./$1")');
    fileContents = fileContents.replaceAll(`@import("./../`, `@import("../`);
  }

  let needsRecurse = true;
  while (needsRecurse) {
    needsRecurse = false;

    const lines = fileContents.split("\n");

    const { declarations, unusedLineIndices } = parseDeclarations(lines, fileContents);
    const thisDeclaration = extractThisDeclaration(declarations);
    const groups = groupDeclarationsByImportPath(declarations);

    promoteItemsWithChildGroups(groups);
    mergeSingleItemGroups(groups);
    const sortedGroupKeys = sortGroupsAndDeclarations(groups);

    const sortedLines = generateSortedOutput(lines, groups, sortedGroupKeys);

    // Remove unused declarations
    if (config.removeUnused) {
      for (const line of unusedLineIndices) {
        sortedLines[line] = DELETED_LINE;
        needsRecurse = true;
      }
    }
    if (thisDeclaration) {
      var onlyCommentsBeforeThis = true;
      for (const [i, line] of sortedLines.entries()) {
        if (i >= thisDeclaration.index) {
          break;
        }
        if (line === "" || line === DELETED_LINE) {
          continue;
        }
        if (!line.startsWith("//")) {
          onlyCommentsBeforeThis = false;
          break;
        }
      }
      if (!onlyCommentsBeforeThis) {
        sortedLines[thisDeclaration.index] = DELETED_LINE;
        let firstNonFileCommentLine = 0;
        for (const line of sortedLines) {
          if (line.startsWith("//!")) {
            firstNonFileCommentLine++;
          } else {
            break;
          }
        }
        const insert = [thisDeclaration.whole, ""];
        if (firstNonFileCommentLine > 0) insert.unshift("");
        sortedLines.splice(firstNonFileCommentLine, 0, ...insert);
      }
    }
    fileContents = sortedLines.join("\n");
  }

  // Remove deleted lines
  fileContents = fileContents.replaceAll(DELETED_LINE + "\n", "");
  // fileContents = fileContents.replaceAll(DELETED_LINE, ""); // any remaining lines

  // Remove any leading newlines
  fileContents = fileContents.replace(/^\n+/, "");

  // Maximum of one empty line
  fileContents = fileContents.replace(/\n\n+/g, "\n\n");

  // Ensure exactly one trailing newline
  fileContents = fileContents.replace(/\s*$/, "\n");

  // If the file is empty, remove the trailing newline
  if (fileContents === "\n") fileContents = "";

  if (fileContents === originalFileContents) {
    return;
  }

  // Write the sorted file
  await Bun.write(filePath, fileContents);

  console.log(`✓ Done: ${filePath}`);
}

// Process all files
async function main() {
  let successCount = 0;
  let errorCount = 0;

  for (const filePath of filePaths) {
    const stat = await Bun.file(filePath).stat();
    if (stat.isDirectory()) {
      const files = readdirSync(filePath, { recursive: true });
      for (const file of files) {
        if (typeof file !== "string" || !file.endsWith(".zig")) continue;
        try {
          await processFile(path.join(filePath, file));
          successCount++;
        } catch (error) {
          errorCount++;
          console.error(`Failed to process ${path.join(filePath, file)}:\n`, error);
        }
      }
      continue;
    }

    try {
      await processFile(filePath);
      successCount++;
    } catch (error) {
      errorCount++;
      console.error(`Failed to process ${filePath}:\n`, error);
    }
  }

  console.log(`\nSummary: ${successCount} files processed successfully, ${errorCount} errors`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

main();
