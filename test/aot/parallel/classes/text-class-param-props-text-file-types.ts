// The text of a class with parameter properties is the text of the file without the types.
class Point {
  constructor(
    public id: number,
    private readonly label = "none",
  ) {}
}
console.log(String(Point));
console.log(
  String(
    class {
      constructor(public id: number) {}
    },
  ),
);
console.log(JSON.stringify(new Point(3)));

const evaluatedAgain = (0, eval)("(" + String(Point) + ")");
console.log(JSON.stringify(new evaluatedAgain(4)));
/* Output:
class Point {
  constructor(
    id,
    label = "none",
  ) {}
}
class {
      constructor(id) {}
    }
{"id":3,"label":"none"}
{}
*/
