// powerSaveBlocker — Electron-compatible API.
//
// Tracks active blockers and their type. Actually inhibiting OS sleep needs a
// platform power API CEF doesn't expose, so this manages the blocker registry
// (start/stop/isStarted), which is what app logic and tests depend on.

type BlockerType = "prevent-app-suspension" | "prevent-display-sleep";

const blockers = new Map<number, BlockerType>();
let nextId = 1;

export const powerSaveBlocker = {
  start(type: BlockerType): number {
    if (type !== "prevent-app-suspension" && type !== "prevent-display-sleep") {
      throw new TypeError("Invalid power save blocker type");
    }
    const id = nextId++;
    blockers.set(id, type);
    return id;
  },

  stop(id: number): boolean {
    return blockers.delete(id);
  },

  isStarted(id: number): boolean {
    return blockers.has(id);
  },
};
