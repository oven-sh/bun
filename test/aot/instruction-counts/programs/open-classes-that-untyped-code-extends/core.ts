export interface Settings {
  name: string;
  limit?: number;
}

export class Core {
  key: string = `${Math.round(7.2)}`;
  listeners = new Set<number>();
  routes = new Map<string, number>();
  history: number[] = [];
  base = 1;
  depth = 0;
  ratio = 0.5;
  isReady = false;
  label = "core";
  limit: number;
  settings: Settings;
  pending: Promise<void> | undefined = undefined;
  parent: Core | undefined = undefined;
  lastError: Error | undefined = undefined;
  add = (value: number): number => this.base + value;
  update = (settings: Settings): void => {
    this.settings = settings;
  };
  emit = (value: number): void => {
    this.listeners.add(value);
  };
  load = (): number => this.base + this.limit;
  self = (): Core => this;
  describe = (): string => this.key + this.settings.name;
  constructor(settings: Settings) {
    this.settings = settings;
    this.limit = settings.limit ?? 10;
  }
}

export function addOne(core: Core): number {
  return core.add(1);
}
