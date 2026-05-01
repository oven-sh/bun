const fs = require("fs");
const path = require("path");

// Regex patterns for different types of top-level declarations
const DECLARATION_PATTERN =
  // pub? (export|extern)? (const|fn|var) name
  /^(pub\s+)?(export\s+|extern\s+)?(const|fn|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

function findDeclarations(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const declarations = [];

  // First pass: collect all declarations with their line numbers
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Skip empty lines and comments
    if (!line || line.trim().startsWith("//") || line.trim().startsWith("///")) {
      continue;
    }

    // Only process top-level declarations (no indentation)
    if (line.startsWith(" ") || line.startsWith("\t")) {
      continue;
    }

    const trimmedLine = line.trim();

    // Check each pattern
    const match = trimmedLine.match(DECLARATION_PATTERN);
    if (match) {
      // Extract the name from the match
      const name = match[match.length - 1]; // Last capture group is the name

      declarations.push({
        name,
        match: match[0],
        line: lineNum + 1,
        type: getDeclarationType(match[0]),
        fullLine: trimmedLine,
        startLine: lineNum,
      });
    }
  }

  // Second pass: calculate sizes based on next declaration's start line
  for (let i = 0; i < declarations.length; i++) {
    const currentDecl = declarations[i];
    const nextDecl = declarations[i + 1];

    if (nextDecl) {
      // Size is from current declaration start to next declaration start
      currentDecl.size = nextDecl.startLine - currentDecl.startLine;
    } else {
      // Last declaration: size is from current declaration start to end of file
      currentDecl.size = lines.length - currentDecl.startLine;
    }
  }

  return declarations;
}

function getDeclarationType(matchText) {
  if (matchText.includes("const")) return "const";
  if (matchText.includes("fn")) return "fn";
  if (matchText.includes("var")) return "var";
  return "unknown";
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: bun longest.js <zig-file>");
    console.error("Example: bun longest.js src/walker_skippable.zig");
    process.exit(1);
  }

  const filePath = args[0];

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  if (!filePath.endsWith(".zig")) {
    console.error("Please provide a .zig file");
    process.exit(1);
  }

  try {
    const declarations = findDeclarations(filePath);

    if (declarations.length === 0) {
      console.log("No top-level declarations found.");
      return;
    }

    console.log(`Found ${declarations.length} top-level declarations in ${filePath}:\n`);

    // Sort by declaration size (smallest first)
    declarations.sort((a, b) => a.size - b.size);

    // Find the longest name for formatting
    const maxNameLength = Math.max(...declarations.map(d => d.match.length));
    const maxTypeLength = Math.max(...declarations.map(d => d.type.length));

    console.log(`${"Name".padEnd(maxNameLength + 2)} ${"Type".padEnd(maxTypeLength + 2)} ${"Num Lines".padEnd(6)}`);
    console.log("-".repeat(maxNameLength + maxTypeLength + 15));

    declarations.forEach(decl => {
      console.log(
        `${decl.match.padEnd(maxNameLength + 2)} ${decl.type.padEnd(maxTypeLength + 2)} ${decl.size.toString().padEnd(6)}`,
      );
    });
  } catch (error) {
    console.error("Error reading file:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
