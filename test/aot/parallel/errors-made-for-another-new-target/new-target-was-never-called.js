// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// Nobody has called the class that is new.target: nobody finds it, and the error has no stack. So it is under `bun <file>`.
class Own extends Error {}
const error = Reflect.construct(Error, ["a"], Own);
console.log(typeof error.stack, error instanceof Own, error.message);
