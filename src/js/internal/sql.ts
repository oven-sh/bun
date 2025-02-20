// This is the file that loads when you pass a '.sql' entry point to Bun.
// It imports the entry points and executes them.

// `import` cannot be used in this file and only Bun builtin modules can be used.
const path = require("node:path");

const initial = performance.now();

async function start() {
  const cwd = process.cwd();
  const args = process.argv.slice(1);

  // Find SQL files to execute
  let sqlFiles: string[] = [];
  for (const arg of args) {
    if (!arg.endsWith(".sql")) {
      if (arg === "--help") {
        console.log(`
Bun v${Bun.version} (sql)

Usage:
  bun [...sql-files]

Examples:
  bun query.sql
  bun ./queries/*.sql
  
This is a small wrapper around Bun.sql() that automatically executes SQL files.
`);
        process.exit(0);
      }
      continue;
    }

    if (arg.includes("*") || arg.includes("**") || arg.includes("{")) {
      const glob = new Bun.Glob(arg);

      for (const file of glob.scanSync(cwd)) {
        let resolved = path.resolve(cwd, file);
        if (resolved.includes(path.sep + "node_modules" + path.sep)) {
          continue;
        }
        try {
          resolved = Bun.resolveSync(resolved, cwd);
        } catch {
          resolved = Bun.resolveSync("./" + resolved, cwd);
        }

        if (resolved.includes(path.sep + "node_modules" + path.sep)) {
          continue;
        }

        sqlFiles.push(resolved);
      }
    } else {
      let resolved = arg;
      try {
        resolved = Bun.resolveSync(arg, cwd);
      } catch {
        resolved = Bun.resolveSync("./" + arg, cwd);
      }

      if (resolved.includes(path.sep + "node_modules" + path.sep)) {
        continue;
      }

      sqlFiles.push(resolved);
    }

    if (args.length > 1) {
      sqlFiles = [...new Set(sqlFiles)];
    }
  }

  if (sqlFiles.length === 0) {
    throw new Error("No SQL files found matching " + JSON.stringify(Bun.main));
  }

  // Execute each SQL file
  for (const file of sqlFiles) {
    const { default: sql } = await import(file, { with: { type: "text" } });

    if (sqlFiles.length > 1) {
      console.log(`${file.replace(cwd + "/", "")}:`);
    }

    const results = await Bun.sql.unsafe(sql);

    if (results.length === 0) {
      if (sqlFiles.length > 1) console.log("Empty output\n");
    } else {
      console.table(results);
      console.log();
    }
  }

  const elapsed = (performance.now() - initial).toFixed(2);
  if (sqlFiles.length > 1) {
    console.log(`Executed ${sqlFiles.length} SQL ${sqlFiles.length === 1 ? "file" : "files"} in ${elapsed}ms`);
  } else {
    console.log(`Executed SQL in ${elapsed}ms`);
  }
}

export default start;
