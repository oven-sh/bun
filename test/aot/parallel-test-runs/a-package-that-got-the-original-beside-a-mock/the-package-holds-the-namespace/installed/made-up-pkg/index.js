import * as dep from "made-up-dep"; export const held = () => "held " + dep.x + " " + Object.keys(dep).join(); export const p = async () => "pkg " + (await import("made-up-dep")).x;
