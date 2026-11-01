import { Shared, bump, read, where } from "@scope/shared";
import { Shared as ByPath } from "../../shared/src/index";
import { Shared as ByAlias } from "~shared";
import { bump as bumpOfState } from "@scope/shared/state";
import { secret } from "#internal/secret";
import { config } from "#config";
import { kind } from "dual";
import { sharedOfPackage, bumpInPackage } from "uses-shared";
import dep from "plain-dep";
export const identities = (): unknown[] => [Shared === ByPath, Shared === ByAlias, sharedOfPackage() === Shared, new ByPath() instanceof Shared, new (sharedOfPackage())() instanceof ByAlias, bump === bumpOfState];
export const counts = (): unknown[] => [bump(), bumpOfState(), bumpInPackage(), read(), Shared.made];
export const names = (): unknown[] => [secret, config, kind, require("dual").kind, dep.name, where];
export async function load(path: string): Promise<unknown> { return (await import(path)).default; }
