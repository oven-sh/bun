export type { Message as SocketMessage, Peer as SocketPeer } from "./messages";
export { type Message as Second, connect, Message as Kept } from "./messages";
import type { Message } from "./messages";
import { type Message as Fourth } from "./messages";
export { Message as Third, Fourth };
export function defineSocket(): number { return 1; }
