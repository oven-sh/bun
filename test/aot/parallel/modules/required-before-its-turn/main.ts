// The importer asks for `early`, `late` and `last`, in that order. While `early` runs it requires `late`, which stands later in that order: `late` and what it imports run then, once, and the importer's own turn for them finds them done.
// STATISTIC: ModulesWithoutState >= 3
// STATISTIC: RequireSitesBound >= 1
import { seen } from "./seen";
import "./early";
import { late } from "./late";
import "./last";

console.log(late, seen.join(", "));
