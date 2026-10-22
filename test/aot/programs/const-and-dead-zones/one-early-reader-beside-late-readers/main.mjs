// `a` and `b` import each other. `b` runs first and calls what `a` exports before `a` has run.
import { results } from "./results.mjs";
import { value, readValue, readOnce, counter, bump } from "./a.mjs";
import "./b.mjs";
results.push(["main", value.name, readValue().name, readOnce().name, counter]);
bump();
results.push(["main", counter]);
for (const line of results) console.log(line.join(" "));
