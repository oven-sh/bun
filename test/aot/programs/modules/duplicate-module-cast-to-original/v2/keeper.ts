export class Keeper {
  private found?: {
    url: string;
    seen: boolean;
    served: string | undefined;
  };
  constructor(private readonly name: string, private readonly config: { url: string }) {}
  note(served: string | undefined): void {
    const found = { url: this.config.url, seen: true };
    this.found = { ...found, served };
  }
  async tokens(): Promise<{ token: string } | undefined> {
    this.note(this.name === "" ? undefined : this.name);
    return this.found?.seen ? { token: "two:" + this.found.url + ":" + this.found.served } : undefined;
  }
  label() {
    return "second";
  }
}
export function describe(keeper: Keeper): string {
  return keeper.label();
}
