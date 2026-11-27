// A field that is added later, stored in a loop whose condition does not ask the counter of its elements.
class Point {
  constructor(x) {
    this.x = x;
  }
}
function fillByAnotherCount(list, count) {
  let done = 0;
  for (let i = 0; done < count; i++) {
    list[i].late = list[i].x * 2;
    done += 1;
  }
}
function fillUntilItIsLate(list) {
  let stop = false;
  for (let i = 0; stop === false; i++) {
    list[i].later = i;
    stop = i + 1 >= list.length;
  }
}
function fillBelow(list, low, high) {
  for (let i = 0; low < high; i++) {
    list[i].low = low;
    low++;
  }
}
const points = [];
for (let i = 0; i < 6; i++)
  points.push(new Point(i));
fillByAnotherCount(points, 4);
fillUntilItIsLate(points);
fillBelow(points, 2, 5);
console.log(points.map(p => `${p.x} ${p.late} ${p.later} ${p.low}`).join(", "));
/*
0 0 0 2, 1 2 1 3, 2 4 2 4, 3 6 3 undefined, 4 undefined 4 undefined, 5 undefined 5 undefined
*/
