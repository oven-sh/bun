// Declarations nobody checked, for declaration-file-alias.ts.
type Port = number;
type Level = "high";
type Mode = "fast" | "slow";
type Pair = [number, string];
type Ports = number[];
type ByName = Map<string, number>;
type Later<T> = Promise<T>;
type Several<T> = T[];
type Options = { verbose: boolean };
interface Host { port: number; mode: Mode }
declare const hostPort: number;
