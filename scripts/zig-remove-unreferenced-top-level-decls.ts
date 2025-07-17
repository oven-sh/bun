import * as fs from "fs";
import * as path from "path";

/**
 * Removes unreferenced top-level const declarations from a Zig file
 * Handles patterns like: const <IDENTIFIER> = @import(...) or const <IDENTIFIER> = ...
 */
export function removeUnreferencedImports(content: string): string {
  let modified = true;
  let result = content;

  // Keep iterating until no more changes are made
  while (modified) {
    modified = false;
    const lines = result.split("\n");
    const newLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match top-level const declarations: const <IDENTIFIER> = ...
      const constMatch = line.match(/^const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=(.*)$/);

      if (constMatch) {
        const identifier = constMatch[1];
        const assignmentPart = constMatch[2];

        // Skip lines that contain '{' in the assignment (likely structs/objects)
        if (assignmentPart.includes("{")) {
          newLines.push(line);
          continue;
        }

        // Check if this identifier is referenced anywhere else in the file
        const isReferenced = isIdentifierReferenced(identifier, lines, i);

        if (!isReferenced) {
          // Skip this line (delete it)
          modified = true;
          console.log(`Removing unreferenced import: ${identifier}`);
          continue;
        }
      }

      newLines.push(line);
    }

    result = newLines.join("\n");
  }

  return result;
}

/**
 * Check if an identifier is referenced anywhere in the file except at the declaration line
 */
function isIdentifierReferenced(identifier: string, lines: string[], declarationLineIndex: number): boolean {
  // Create a regex that matches the identifier as a whole word
  // This prevents matching partial words (e.g. "std" shouldn't match "stdx")
  const identifierRegex = new RegExp(`\\b${escapeRegex(identifier)}\\b`);

  for (let i = 0; i < lines.length; i++) {
    // Skip the declaration line itself
    if (i === declarationLineIndex) {
      continue;
    }

    const line = lines[i];

    // Check if the identifier appears in this line
    if (identifierRegex.test(line)) {
      return true;
    }
  }

  return false;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Process a single Zig file
 */
export function processZigFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const cleaned = removeUnreferencedImports(content);

    if (content !== cleaned) {
      fs.writeFileSync(filePath, cleaned);
      console.log(`Cleaned: ${filePath}`);
    } else {
      console.log(`No changes: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }
}

/**
 * Process multiple Zig files or directories
 */
export function processFiles(paths: string[]): void {
  for (const inputPath of paths) {
    const stat = fs.statSync(inputPath);

    if (stat.isDirectory()) {
      // Process all .zig files in directory recursively
      processDirectory(inputPath);
    } else if (inputPath.endsWith(".zig")) {
      processZigFile(inputPath);
    } else {
      console.warn(`Skipping non-Zig file: ${inputPath}`);
    }
  }
}

/**
 * Recursively process all .zig files in a directory
 */
function processDirectory(dirPath: string): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      processDirectory(fullPath);
    } else if (entry.name.endsWith(".zig")) {
      processZigFile(fullPath);
    }
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: bun zig-remove-unreferenced-top-level-decls.ts <file1.zig> [file2.zig] [directory]...");
    console.log("");
    console.log("Examples:");
    console.log("  bun zig-remove-unreferenced-top-level-decls.ts file.zig");
    console.log("  bun zig-remove-unreferenced-top-level-decls.ts src/");
    console.log("  bun zig-remove-unreferenced-top-level-decls.ts file1.zig file2.zig src/");
    process.exit(1);
  }

  processFiles(args);
}
