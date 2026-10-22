// The entry point imports k.cjs, which imports the entry point dynamically while it runs. Another file holds a require() of the entry point. The import() starts nothing there and then.
import k from "./k.cjs";
import other from "./other.cjs";
export const value = "main";
console.log("the entry point runs", k.state, other.get());
