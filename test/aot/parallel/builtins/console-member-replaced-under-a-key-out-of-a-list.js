// `console` comes out of a list that may also be a value the build knows nothing about. The keys come out of a list of names that the build knows.
const print = console.log.bind(console);
let holders = [console];
if (process.argv.length > 5) holders = globalThis[process.argv[5]];
for (const holder of holders) {
  for (const key of ["log", "warn"]) {
    let outcome;
    try {
      outcome = (holder[key] = () => "replaced " + key) !== undefined;
    } catch (error) {
      outcome = error.name;
    }
    print(outcome, console.log("to the replacement"), key === "warn" ? console.warn("to the replacement") : "not yet");
  }
}
