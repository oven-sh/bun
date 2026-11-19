import { box, run, plain } from "pack";
export const look = () => [run(), box.f.mock?.calls.length ?? "none", plain(), plain.mock?.calls.length ?? "none"].join(" ");
