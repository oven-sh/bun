import { stdout, stderr } from "node:process";
export const held = () => stdout;
export const error = () => stderr;
