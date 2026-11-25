// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// CHECK-LABEL: function {{*}}name="Local"
// CHECK-LABEL: function {{*}}name="run"

// FILE: main.ts
// The same with experimentalDecorators, for a class of this file and for exported classes of a file that is imported for its effects only.
import { registry, register } from "./registry";
import "./handlers";

@register("local")
class Local {
  run(): string {
    return "local ran";
  }
}

for (const [name, entry] of registry) console.log(name, new entry().run());

// FILE: handlers.ts
import { register } from "./registry";

function shout(text: string): string {
  return text.toUpperCase();
}

@register("first")
export class First {
  run(): string {
    return shout("first ran");
  }
}

@register("second")
class Second {
  run(): string {
    return shout("second ran");
  }
}

// FILE: registry.ts
export const registry = new Map<string, new () => { run(): string }>();

export function register(name: string) {
  return (value: new () => { run(): string }): void => {
    registry.set(name, value);
  };
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "experimentalDecorators": true } }
