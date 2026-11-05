// The package ships TypeScript, says that it has no side effects, and has a tsconfig.json whose `lib` is not the program's. One of its files is named for a type alone, and nobody reads the constant of it that the index hands on.
import { matches } from "typed-sources";
console.log(matches({ id: 7, names: [] }), matches({ id: 1, names: ["x"] }));
