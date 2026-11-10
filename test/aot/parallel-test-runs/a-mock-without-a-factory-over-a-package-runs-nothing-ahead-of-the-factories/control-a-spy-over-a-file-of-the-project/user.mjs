import { box, run, plain } from "./part.mjs";
export const look = () => run() + " " + (box.f.mock?.calls.length ?? "none") + " " + (run.mock?.calls.length ?? "none") + " " + plain() + " " + (plain.mock?.calls.length ?? "none");
