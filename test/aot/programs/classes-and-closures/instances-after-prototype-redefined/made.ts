import { log } from "./log";
class Observed { declare size: number; constructor(size: number) { this.size = size; } }
Object.defineProperty(Observed.prototype, "size", { set(size: number) { log.push("set " + size); }, configurable: true });
export const observed = new Observed(1);

class Later { declare size: number; constructor(size: number) { this.size = size; } }
const later = new Later(2);
export function readLater(): Later { return later; }
export function redefineLater(): void { Object.defineProperty(Later.prototype, "size", { set(size: number) { log.push("set " + size); }, configurable: true }); }
