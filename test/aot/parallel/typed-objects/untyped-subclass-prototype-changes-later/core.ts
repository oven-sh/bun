export class Core {
  declare first: unknown;
  declare second?: number;
  declare third?: string;
  always = "always";
  constructor(options: any) {
    this.first = options;
  }
  setSecond(value: number) {
    this.second = value;
  }
  setThird(value: string) {
    this.third = value;
  }
  readThird(): unknown {
    return this.third;
  }
  hasThird(): boolean {
    return "third" in this;
  }
  hasOther(): boolean {
    return "other" in this;
  }
  describe(): string {
    return [String(this.first), String(this.second), String(this.third), this.always].join();
  }
}
export function describeAny(core: Core): string {
  return core.describe() + " " + core.hasThird() + " " + core.hasOther() + " " + String(core.readThird());
}
