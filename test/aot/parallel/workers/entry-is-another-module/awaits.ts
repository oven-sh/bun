import { bump } from "./lib/shared";
await new Promise(resolve => setTimeout(resolve, 5));
const later = await import("./lib/shared");
postMessage("awaited " + bump() + " " + (later.bump === bump));
