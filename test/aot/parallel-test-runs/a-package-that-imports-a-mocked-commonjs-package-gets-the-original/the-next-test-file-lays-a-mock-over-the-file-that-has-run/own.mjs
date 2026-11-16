import { value, kind } from "dep";
export const seen = async () => { try { return value() + ":" + String(kind); } catch (e) { return e.name; } };
