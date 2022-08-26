import { Sha512 } from "https://deno.land/std/hash/sha512.ts";

import { bench, run } from "https://esm.run/mitata";

bench("Sha512", () => new Sha512().update("hello world").arrayBuffer());

await run();
