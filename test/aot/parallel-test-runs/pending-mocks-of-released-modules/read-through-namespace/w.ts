import { log } from "./r.ts";
export class Socket { name = "socket"; }
export const socket = () => new Socket().name + log("w");
