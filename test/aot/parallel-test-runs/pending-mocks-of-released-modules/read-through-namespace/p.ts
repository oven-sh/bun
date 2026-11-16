import * as g from "./g.ts";
import { socket } from "./w.ts";
import { log } from "./r.ts";
export const call = () => [g.intents.guilds, socket(), log(1 + String())].join(" ");
