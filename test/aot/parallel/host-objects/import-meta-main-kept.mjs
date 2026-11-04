// Nothing stores into import.meta.main here: other members are stored and read.
import.meta.url = "stored";
console.log(import.meta.main, import.meta.url, typeof import.meta.resolve, typeof import.meta.env);
if (!import.meta.main) throw new Error("the entry point is the main module");
