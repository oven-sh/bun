// A name of a module of the library that is only a type is no export when the program runs: a module whose code reads it fails to link. One that only hands it on, or uses it as a type, runs.
async function attempt(label: string, load: () => Promise<object>) {
  try {
    console.log(label, "loaded", Object.keys(await load()));
  } catch (error) {
    console.log(label, (error as Error).name, (error as Error).message);
  }
}

await attempt("exports it by default", () => import("./exports-it-by-default"));
await attempt("reads it in a function", () => import("./reads-it-in-a-function"));
await attempt("uses it as a type", () => import("./uses-it-as-a-type"));
await attempt("exports it by default again", () => import("./exports-it-by-default"));
