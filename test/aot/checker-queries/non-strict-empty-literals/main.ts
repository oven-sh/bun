import { Queue, remember, collect, one, state, either } from "./inner/empty-literals.ts";
console.log(new Queue().add(1), remember(1), collect(1), one(1), state(1), either(1, true));
