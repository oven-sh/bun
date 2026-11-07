// `console` comes out of a list that may also be a value the build knows nothing about, and its `log` is replaced through that receiver.
const print = console.log.bind(console);
let holders = [console];
if (process.argv.length > 5) holders = globalThis[process.argv[5]];
for (const holder of holders) {
  let outcome;
  try {
    outcome = (holder.log = () => "replaced") !== undefined;
  } catch (error) {
    outcome = error.name;
  }
  print(outcome, console.log("to the replacement"));
}
