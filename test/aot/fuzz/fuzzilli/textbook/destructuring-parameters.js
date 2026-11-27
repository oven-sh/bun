function summary({ name, size: { width, height = 1 } }, [first, , third = "none"]) {
  return name + " " + width * height + " " + first + third;
}
console.log(
  summary({ name: "door", size: { width: 2 } }, ["a", "b"]),
  summary({ name: "wall", size: { width: 2, height: 3 } }, "xyz"),
);
