import { fromSouth } from "./south.ts";
const listed: () => string = (globalThis as unknown as { listed: () => string }).listed;
export const seen: string = listed() + fromSouth;
