import { say } from "./helpers/say";
import { identities, counts, names } from "../src/main";
import { Shared, read } from "@scope/shared";
import { Shared as ByAlias } from "~shared";
import { identities as byAppAlias } from "@app/main";
say("a", "one module however it is named", () => [identities(), Shared === ByAlias, byAppAlias === identities]);
say("a", "one state", () => [counts(), read(), new Shared().who()]);
say("a", "conditions, imports and names", () => names());
