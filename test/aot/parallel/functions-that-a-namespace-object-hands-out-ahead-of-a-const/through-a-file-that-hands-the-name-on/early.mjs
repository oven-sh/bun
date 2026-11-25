import * as hub from "./hub.mjs";
export let seen = "not run";
for (const member of Object.values(hub)) {
    try { seen = String(member()); } catch (e) { seen = e.name; }
}
