import type { Settings } from "api";
export function next(settings: Settings): number {
  return settings.n + 1;
}
