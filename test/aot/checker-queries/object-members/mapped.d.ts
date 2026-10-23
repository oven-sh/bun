// Declarations nobody checked, for mapped.ts.
interface Host { port: number }
type Mine<T> = { [K in keyof T]: T[K] };
type HostOptions = { [K in "port"]: number };
interface HostTable { [key: string]: number }
