import { ran, track } from "../events.mjs";
export let finished = false;
ran("child starts");
await null;
track("itself", import("./child.mjs"));
track("its parent", import("./parent.mjs"));
track("its grandparent", import("./grandparent.mjs"));
ran("child ends");
finished = true;
