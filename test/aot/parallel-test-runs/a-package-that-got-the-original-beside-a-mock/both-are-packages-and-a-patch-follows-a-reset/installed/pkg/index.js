import { x } from "dep"; export const held = () => "held " + x; export const p = async () => "pkg " + (await import("dep")).x;
