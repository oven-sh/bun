// The initializer of a variable reads out of an object of another file. Where nobody changes that object, the initializer is put off until the first read of the variable.
// Here the object changes in between, by one road. The variable holds what the object held where the declaration stands.
// Alone: what is put off goes by all that the executable holds
import { read } from "./m.mjs";
import { cfg } from "./cfg.mjs";
setTimeout(() => { cfg.name = "second"; cfg.nested.n = 2; }, 0);
setTimeout(() => { console.log(read().title, read().deep); }, 5);
