import { top, topName, hit } from "./top.mjs";
import { low } from "./low.mjs";
export const user = () => [top(), topName, hit && hit(), low()].join();
