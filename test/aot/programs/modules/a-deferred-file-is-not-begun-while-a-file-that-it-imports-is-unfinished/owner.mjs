try {
  console.log("looked", globalThis.deferred.seen);
} catch (error) {
  console.log(error.name, error.message);
}
export var text = "a" + process.argv.length;
export let list = [process.argv.length];
export class Kind {
  static size = process.argv.length;
}
console.log("owner ends");
