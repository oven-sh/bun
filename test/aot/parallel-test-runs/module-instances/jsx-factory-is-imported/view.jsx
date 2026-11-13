import { h, Frag } from "./h.ts";
export function view() { return String(<b id="x">one</b>); }
export const arrow = () => String(<><i/>two</>);
export class Widget { render() { return String(<u>{"three"}</u>); } keyed(p) { return String(<s {...p} key="k" />); } static made = () => String(<a/>); }
export const later = function* () { yield String(<em/>); };
export const nested = () => [1].map(() => String(<q/>)).join();
