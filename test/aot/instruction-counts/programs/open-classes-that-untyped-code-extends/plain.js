import { Core } from "./core.ts";

class UntypedCore {
  key = `${Math.round(7.2)}`;
  listeners = new Set();
  routes = new Map();
  history = [];
  base = 1;
  depth = 0;
  ratio = 0.5;
  isReady = false;
  label = "core";
  limit;
  settings;
  pending = undefined;
  parent = undefined;
  lastError = undefined;
  add = value => this.base + value;
  update = settings => {
    this.settings = settings;
  };
  emit = value => {
    this.listeners.add(value);
  };
  load = () => this.base + this.limit;
  self = () => this;
  describe = () => this.key + this.settings.name;
  constructor(settings) {
    this.settings = settings;
    this.limit = settings.limit ?? 10;
  }
}

class HeirOfTyped extends Core {}
class HeirOfUntyped extends UntypedCore {}
const settings = { name: "a", limit: 3 };

export const makeTyped = () => new HeirOfTyped(settings);
export function emptyLoop(n) {
  let last = settings;
  for (let i = 0; i < n; i++) if (last !== undefined) last = settings;
  return last.limit;
}
export function constructTyped(n) {
  let last;
  for (let i = 0; i < n; i++) last = new HeirOfTyped(settings);
  return last.limit;
}
export function constructUntyped(n) {
  let last;
  for (let i = 0; i < n; i++) last = new HeirOfUntyped(settings);
  return last.limit;
}
export function constructTypedAndCall(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += new HeirOfTyped(settings).add(i);
  return sum;
}
export function constructUntypedAndCall(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += new HeirOfUntyped(settings).add(i);
  return sum;
}
