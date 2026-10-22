interface Settings {
  depth: number;
}
declare var installed: number | undefined;
(globalThis as { installed?: number }).installed = 5;
