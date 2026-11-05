export class Shared { static made = 0; id: number; constructor() { this.id = ++Shared.made; } who(): string { return "shared " + this.id; } }
export { bump, read } from "./state";
export const where = import.meta.url.split("/").slice(-4).join("/");
