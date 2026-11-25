import { api, escape } from "./barrel.mjs";
console.log(api.escapeHTML("<a>"), escape("<b>"));
