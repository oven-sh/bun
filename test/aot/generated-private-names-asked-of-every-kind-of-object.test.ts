// Fixed seeds of fuzz/private-names-asked-of-every-kind-of-object.ts: classes with private fields, methods, getters and setters, read, stored to, called and asked for in twenty ways, of instances,
// of instances of other classes, of the same class evaluated again, of proxies, of objects that were given the names by a constructor that returns them, and of what is no object.
import { generate } from "./fuzz/private-names-asked-of-every-kind-of-object";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "private names asked of every kind of object",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
