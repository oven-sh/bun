import { intents } from "./g.ts";
import { socket } from "./w.ts";
import { log } from "./r.ts";
export const call = () => [intents.guilds, socket(), log(1 + String())].join(" ");
