import { program as expressions } from "./generated/constant-expressions";
import { program as places } from "./generated/folded-values";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 96 }, (_, i) => i + 1);
const languages = [false, true];

generated(
  "constant expressions",
  seeds.flatMap(seed =>
    languages.map(isTypeScript => ({
      name: `seed ${seed}, ${isTypeScript ? "TypeScript" : "JavaScript"}`,
      isAlwaysRun: seed <= 4,
      make: () => expressions(seed, isTypeScript),
    })),
  ),
);
generated(
  "folded values",
  seeds.slice(0, 24).flatMap(seed =>
    languages.map(isTypeScript => ({
      name: `seed ${seed}, ${isTypeScript ? "TypeScript" : "JavaScript"}`,
      isAlwaysRun: seed <= 2,
      make: () => places(seed, isTypeScript),
    })),
  ),
);
