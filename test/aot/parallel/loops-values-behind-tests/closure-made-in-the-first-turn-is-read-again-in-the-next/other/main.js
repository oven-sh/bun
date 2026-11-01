import { Point, Below, Other } from "./declared-1.js";
import { told, mark0, look0, mark1, look1, mark2 } from "./declared-2.js";
import { look2, mark3, look3 } from "./declared-3.js";
Point.prototype.inherited = "from the prototype";
{
  for (let i = 0; i < 1; i++) told(() => look0(mark0({ x: 1, y: 2 }, i)));
  console.log(
    "scene 0 usual",
    told(() => look0(mark0({ x: 1, y: 2 }, 1))),
    "| without",
    told(() => look0({ x: 1, y: 2 })),
  );
  console.log(
    "scene 0",
    told(() => look0(mark0(new Proxy(new Point(1, 2), {}), 2))),
    "| without",
    told(() => look0(new Proxy(new Point(1, 2), {}))),
  );
  console.log(
    "scene 0 usual again",
    told(() => look0(mark0({ x: 1, y: 2 }, 3))),
  );
}
{
  for (let i = 0; i < 1; i++) told(() => look1(mark1(new Point(1, 2), i)));
  console.log(
    "scene 1 usual",
    told(() => look1(mark1(new Point(1, 2), 1))),
    "| without",
    told(() => look1(new Point(1, 2))),
  );
  console.log(
    "scene 1",
    told(() => look1(mark1({ x: 1, y: 2 }, 2))),
    "| without",
    told(() => look1({ x: 1, y: 2 })),
  );
  console.log(
    "scene 1",
    told(() => look1(mark1(new Proxy(new Point(1, 2), {}), 2))),
    "| without",
    told(() => look1(new Proxy(new Point(1, 2), {}))),
  );
  console.log(
    "scene 1 usual again",
    told(() => look1(mark1(new Point(1, 2), 3))),
  );
}
{
  for (let i = 0; i < 300; i++) told(() => look2(mark2(new Point(1, 2), i)));
  console.log(
    "scene 2 usual",
    told(() => look2(mark2(new Point(1, 2), 1))),
    "| without",
    told(() => look2(new Point(1, 2))),
  );
  console.log(
    "scene 2",
    told(() => look2(mark2(Object.create(Point.prototype), 2))),
    "| without",
    told(() => look2(Object.create(Point.prototype))),
  );
  console.log(
    "scene 2",
    told(() => look2(mark2(new Proxy(new Point(1, 2), {}), 2))),
    "| without",
    told(() => look2(new Proxy(new Point(1, 2), {}))),
  );
  console.log(
    "scene 2 usual again",
    told(() => look2(mark2(new Point(1, 2), 3))),
  );
}
{
  console.log(
    "scene 3 usual",
    told(() => look3(mark3(new Below(1, 2), 1))),
    "| without",
    told(() => look3(new Below(1, 2))),
  );
  console.log(
    "scene 3",
    told(() => look3(mark3(new Other(), 2))),
    "| without",
    told(() => look3(new Other())),
  );
  console.log(
    "scene 3",
    told(() => look3(mark3(Object.create(Point.prototype), 2))),
    "| without",
    told(() => look3(Object.create(Point.prototype))),
  );
  console.log(
    "scene 3 usual again",
    told(() => look3(mark3(new Below(1, 2), 3))),
  );
}
