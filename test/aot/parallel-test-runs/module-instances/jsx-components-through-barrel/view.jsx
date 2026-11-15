import { Panel, parts } from "./barrel.ts";
import * as all from "./barrel.ts";
const tags = () => [<Panel/>, <parts.Panel/>, <all.Panel/>].map(it => String(it)).join();
export const view = tags, arrow = () => String(<Panel/>), nested = () => [1].map(() => String(<parts.Panel/>)).join();
export class Widget { render() { return String(<all.Panel/>); } keyed(p) { return String(<Panel {...p} key="k"/>); } static made = () => tags(); }
export const later = function* () { yield String(<Panel/>); };
