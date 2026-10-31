import { bump } from "./lib/shared";
postMessage("loads " + bump());
throw new Error("while it loads");
