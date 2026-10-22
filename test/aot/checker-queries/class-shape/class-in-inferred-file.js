// A class of a JavaScript file: nobody wrote a type, so every member is unwritten and has the type that the checker concludes.
export class Point {
  x = 1;
  label = "p";
  move(by) { this.x += by; return this; }
}
