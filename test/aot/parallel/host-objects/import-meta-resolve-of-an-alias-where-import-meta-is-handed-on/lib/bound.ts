import { tail } from "./tail";

export const kept = import.meta.resolve.bind(import.meta);
const names = process.argv.length > 5 ? ["./thing.ts"] : ["@lib/thing", "@lib/other"];
export const askBesideABoundCopy = () => names.map(name => tail(() => import.meta.resolve(name)));
