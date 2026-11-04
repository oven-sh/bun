// The text of a class with parameter properties is the text of the file without the types, with the fields and the stores that the parameters stand for.
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
  id; label; constructor(
    id,
    label = "none",
  ) { this.id = id; this.label = label;}
}
class {
      id; constructor(id) { this.id = id;}
    }
{"id":3,"label":"none"}
{"id":4,"label":"none"}
*/
