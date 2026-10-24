// What a package's declaration file says of the host's settings, for main.ts.
export type Port = number;
export type Level = "high";
export type Mode = "fast" | "slow";
export type Pair = [number, string];
export interface Host { port: number; mode: Mode }
