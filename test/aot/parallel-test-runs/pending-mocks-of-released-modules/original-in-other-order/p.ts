import { socket } from "./w.ts";
import { intents } from "./g.ts";
export const call = () => [intents.guilds, socket()].join(" ");
