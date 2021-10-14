const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const exec = (cmd, opts = {}) => {
  console.log("$", cmd);
  return execSync(cmd, {
    ...opts,
    env: { CI: "true", ...process.env, ...(opts.env || {}) },
  });
};

const DRY_RUN = !!process.env.DRY_RUN;

var count = 0;

const examplesFolderEntries = fs.readdirSync(
  path.join(process.cwd(), "examples"),
  { withFileTypes: true }
);

const packageNames = [];

for (let folder of examplesFolderEntries) {
  if (!folder.isDirectory()) continue;
  const absolute = path.resolve(process.cwd(), "examples", folder.name);

  let packageJSONText;

  try {
    packageJSONText = fs.readFileSync(
      path.join(absolute, "package.json"),
      "utf8"
    );
  } catch {
    continue;
  }

  let packageJSON = JSON.parse(packageJSONText);

  if (!packageJSON.name) continue;
  if (!packageJSON.name.startsWith("@bun-examples")) continue;

  var version = "0.0.1";
  try {
    const _versions = exec(`npm view ${packageJSON.name} versions --json`)
      .toString()
      .trim();

    if (_versions.length > 0) {
      const versionsArray = JSON.parse(_versions);
      version = versionsArray[versionsArray.length - 1];
    }
  } catch (exception) {
    console.error(exception);
  }
  var retryCount = 5;

  restart: while (retryCount-- > 0) {
    packageJSON.version = version;
    if ("private" in packageJSON) delete packageJSON.private;
    if ("license" in packageJSON) delete packageJSON.license;

    try {
      fs.copyFileSync(
        path.join(absolute, ".gitignore"),
        path.join(absolute, "gitignore")
      );
    } catch (exception) {}

    fs.writeFileSync(
      path.join(absolute, "package.json"),
      JSON.stringify(packageJSON, null, 2)
    );
    exec(`npm version patch --force`, { cwd: absolute });

    packageJSON = JSON.parse(
      fs.readFileSync(path.join(absolute, "package.json"), "utf8")
    );
    version = packageJSON.version;

    try {
      exec(
        `npm publish ${
          DRY_RUN ? "--dry-run" : ""
        } --access public --registry https://registry.npmjs.org/`,
        { cwd: absolute }
      );
      packageNames.push([
        packageJSON.name,
        {
          version: packageJSON.version,
          description: packageJSON.description || "",
        },
      ]);
      count++;
      break;
    } catch (exception) {
      continue restart;
    }
  }
}

if (packageNames.length > 0) {
  const packageJSON = {
    name: "bun-examples-all",
    private: false,
    version: `0.0.${Date.now()}`,
    description: "All bun-examples",
    examples: Object.fromEntries(packageNames),
  };
  const dir = path.join(process.cwd(), "examples/bun-examples-all");
  try {
    fs.rmSync(dir, {
      recursive: true,
      force: true,
    });
  } catch (exception) {}

  try {
    fs.mkdirSync(dir, {
      recursive: true,
    });
  } catch (exception) {}
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(packageJSON, null, 2)
  );
  exec(
    `npm publish ${
      DRY_RUN ? "--dry-run" : ""
    } --access public --registry https://registry.npmjs.org/`,
    { cwd: dir }
  );
}

console.log(`Published ${count} packages`);
