import { base } from "./dep.mjs";
globalThis.loads = (globalThis.loads ?? 0) + 1;
export const load = globalThis.loads;
const step = load * 10;
export class Vault {
  #secret;
  static #made = 0;
  constructor(x) { this.#secret = x * base; this.open = x; Vault.#made++; }
  #double(n) { return n * 2 + step; }
  peek(other) { return other.#secret + step; }
  add(n) { this.#secret += n; return this.#double(this.#secret) + load; }
  has(other) { return #secret in other; }
  get secret() { return this.#secret; }
  set secret(v) { this.#secret = v + load; }
  static made() { return Vault.#made + step; }
  static make(x) { return new Vault(x + load); }
}
export class Safe extends Vault { #extra = step; extra(other) { return other.#extra + super.add(1); } }
export function make(x) { return new Vault(x); }
export function makeSafe(x) { return new Safe(x); }
export function made() { return Vault.made() + Vault.make(1).secret; }
