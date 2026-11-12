import * as hub from "loom/hub.mjs";
import * as tail from "loom/tail.mjs";
const said = space => Object.keys(space).sort().map(key => key + "=" + String(Reflect.get(space, key))).join();
export const look = () => said(hub) + " | " + said(tail);
