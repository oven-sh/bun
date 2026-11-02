// The function that makes `console.Console` is written against the type of a writable stream and loads no stream. In a program that loads none either, the file that declares that
// type is in the build for the type alone.
console.log(typeof console.Console);
const attempts = [() => console.Console(), () => console.Console(1), () => console.Console("a", {}), () => new console.Console(), () => new console.Console("a")];
for (const attempt of attempts) {
  try {
    console.log(typeof attempt());
  } catch (error) {
    console.log(error.name, error.code);
  }
}
