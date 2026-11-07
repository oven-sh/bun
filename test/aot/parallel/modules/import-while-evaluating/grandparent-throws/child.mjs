import { ran, track } from "../events.mjs";
export let finished = false;
ran("child starts");
track("itself", import("./child.mjs"));
track("its parent", import("./parent.mjs"));
track("its grandparent", import("./grandparent.mjs"));
ran("child ends");
finished = true;
