import { x } from "made-up-dep"; export const held = () => "held " + x; export const p = async () => "pkg " + (await import("made-up-dep")).x;
