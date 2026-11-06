import type { Settings } from "the-app";
export function next(settings: Settings): number {
  return settings.n + 1;
}
