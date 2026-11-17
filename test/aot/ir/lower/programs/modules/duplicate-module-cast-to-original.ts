// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4
// CHECK-LABEL: function {{*}}name="live"
// CHECK-LABEL: function {{*}}name="refresh"

// FILE: main.ts
// The program has two copies of one module. Each declares a class with the same name and a private member, and an accessor returns either namespace cast to the first copy's type. Instances created from the returned class behave as in plain Bun.
function live(given: { token: string } | undefined): string | undefined {
  return given?.token;
}
async function refresh(generation: number, name: string): Promise<string | undefined> {
  const { keeperModule } = await import("./pick.ts");
  const { Keeper, describe } = keeperModule(generation);
  const keeper = new Keeper(name, { url: "u" });
  return describe(keeper) + " " + live(await keeper.tokens());
}
console.log(await refresh(1, "n"), "|", await refresh(1, ""));
console.log(await refresh(2, "n"), "|", await refresh(2, ""));

// FILE: keeper.ts
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
    return this.found?.seen ? { token: "one:" + this.found.url + ":" + this.found.served } : undefined;
  }
  label() {
    return "first";
  }
}
export function describe(keeper: Keeper): string {
  return keeper.label();
}

// FILE: pick.ts
export function keeperModule(generation: number): typeof import("./keeper.ts") {
  if (generation === 2) {
    return require("./v2/keeper.ts") as typeof import("./keeper.ts");
  }
  return require("./keeper.ts") as typeof import("./keeper.ts");
}

// FILE: v2/keeper.ts
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

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
