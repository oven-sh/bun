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
