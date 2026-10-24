// import(name): the promise is rejected with ERR_MODULE_NOT_FOUND for a library module that is not in the executable; await in try, .catch and the second argument of .then all get it. Plain Bun finds the module.
import "node:path";

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof (await import(name)));
  } catch (error) {
    console.log(name, error.code, error instanceof Error);
  }
  console.log(name, await import(name).then(loaded => typeof loaded, error => "rejected " + error.code));
  console.log(name, await import(name).then(loaded => typeof loaded).catch(error => "caught " + error.code));
}
console.log("went on");
