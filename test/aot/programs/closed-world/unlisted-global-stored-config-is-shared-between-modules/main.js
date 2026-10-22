import { read } from "./reads-the-config.js";
const config = (globalThis.__sharedConfig ??= {});
Object.assign(config, { localeError: issue => "bad " + issue.code + " " + (issue.values ?? []).join("|") });
console.log(read({ code: "value", values: [1, 2] }));
