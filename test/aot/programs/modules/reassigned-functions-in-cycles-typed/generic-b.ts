import { first, replace } from "./generic-a";
export const seen: string = String(first([7, 8])) + first<string>([], "none");
replace();
