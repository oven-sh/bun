import { name } from "./services";
export const call = () => { const seen = new Set<string>(); for (let i = 0; i < 64; i++) seen.add(name()); return [...seen].join("|"); };
