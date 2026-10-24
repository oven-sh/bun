import type { Any5, Any8 } from "./any";
import type { Deep } from "./deep";
export function parse5(text: string): Deep<Any5> { return JSON.parse(text) as Deep<Any5>; }
export function parse8(text: string): Deep<Any8> { const made = JSON.parse(text) as Deep<Any8>; return made; }
export function plain5(text: string): Any5 { return JSON.parse(text) as Any5; }
export function from(value: unknown): Deep<Any8> { return value as Deep<Any8>; }
