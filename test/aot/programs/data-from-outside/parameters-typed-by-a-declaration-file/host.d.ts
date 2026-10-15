// What a package's declaration file says of the host's handlers, for main.ts.
export interface Handler<Data = unknown> { open?(socket: Socket<Data>): void; data?(socket: Socket<Data>, buffer: Uint8Array): void; close?(socket: Socket<Data>, code: number): string }
export interface Socket<Data> { data: Data; write(text: string): number }
export type Listener = (event: { kind: string; count: number }) => void;
