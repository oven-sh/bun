import { frame } from "./layout.mjs";
export let seen = "not run";
try { seen = frame(); } catch (error) { seen = error.name; }
