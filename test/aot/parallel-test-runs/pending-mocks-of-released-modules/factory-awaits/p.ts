import { intents } from "./g.ts";
import { socket } from "./w.ts";
export const call = () => [intents.guilds, socket()].join(" ");
