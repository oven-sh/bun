import * as loaded from "bun:main";
postMessage(JSON.stringify([Object.keys(loaded), typeof loaded.default, "default" in loaded]));
