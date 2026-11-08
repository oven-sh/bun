// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4

// FILE: main.ts
// A class that a module exports only as a type is not a member of the module's namespace object.
import * as direct from "./sockets";
import * as through from "./index";
console.log(Object.keys(direct).sort().join(","));
console.log(Object.keys(through).sort().join(","));
console.log(Object.keys(await import("./sockets")).sort().join(","));
console.log("SocketMessage" in direct, (through as any).Third, new direct.Kept().text);

// FILE: index.ts
export { type SocketMessage, type SocketPeer, defineSocket } from "./sockets";
export * from "./sockets";

// FILE: messages.ts
export class Message { text = "message" }
export interface Peer { id: string }
export function connect(): number { return 1; }

// FILE: sockets.ts
export type { Message as SocketMessage, Peer as SocketPeer } from "./messages";
export { type Message as Second, connect, Message as Kept } from "./messages";
import type { Message } from "./messages";
import { type Message as Fourth } from "./messages";
export { Message as Third, Fourth };
export function defineSocket(): number { return 1; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
