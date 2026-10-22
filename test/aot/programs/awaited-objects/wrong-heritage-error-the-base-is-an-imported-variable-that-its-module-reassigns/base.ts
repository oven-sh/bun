export let Body = class {
  mass = 1;
  constructor(...ignored: unknown[]) {}
  weight(): number {
    return this.mass * 2;
  }
};

export function replaceBody(other: unknown): void {
  Body = other as typeof Body;
}
