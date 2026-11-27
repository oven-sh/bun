import * as got from "./rows.json";
postMessage([String(got.b), "b" in got, Object.keys(got).sort().join()].join(" "));
