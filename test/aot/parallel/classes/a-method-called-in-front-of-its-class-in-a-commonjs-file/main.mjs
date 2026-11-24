// In a CommonJS file, a method is called on an object before the class that declares a method of that name is evaluated.
import library from "./library.cjs";
console.log(library.said);
