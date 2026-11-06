console.log(typeof require.main.filename, typeof require.main?.path, require("node:path").basename(require.main.filename));
