import { read } from "./holder";
export enum Level { Low, High }
export function show(): string { return read() + " " + typeof Level; }
