const { mkdirSync, existsSync } = require("fs");

const count = parseInt(process.env.MKDIR_DEPTH || "1", 10) || 1;
var tempdir = `/tmp/some-fs-test/dir/${Date.now()}/hi`;

for (let i = 0; i < count; i++) {
  tempdir += `/${i.toString(32)}`;
}

if (existsSync(tempdir)) {
  throw new Error(
    `existsSync reports ${tempdir} exists, but it probably does not`
  );
}

mkdirSync(tempdir, { recursive: true });

if (!existsSync(tempdir)) {
  throw new Error(
    "Expected directory to exist after mkdirSync, but it doesn't"
  );
}

if (mkdirSync(tempdir, { recursive: true })) {
  throw new Error(
    "mkdirSync shouldn't return directory name on existing directories"
  );
}
