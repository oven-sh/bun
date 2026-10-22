import { shared } from "./shared.mjs";
import { six } from "./leaf-six.cjs";
import { b } from "./cycle-b.mjs";
import { inner } from "./inner.mjs";
ran.push("second");
export const describe = () => [shared, six, b(), inner].join(" | ");
