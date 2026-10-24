import { list, made } from "./main"
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
export const seen = attempt(() => made) + " " + attempt(() => list)
