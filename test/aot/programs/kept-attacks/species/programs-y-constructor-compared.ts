// Species: programs y constructor compared. It prints what plain Bun prints.
class Point { x = 1; }
class Other { y = 2; }
const held: any[] = JSON.parse("[]");
held.push(new Point(), new Other());
console.log(held[0].constructor === Point, held[1].constructor === Point, held[1].constructor === Other, held[0].constructor.name);
