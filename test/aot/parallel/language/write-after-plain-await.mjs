// Awaiting a non-thenable always resumes, so a write to a locked built-in after it is still a build error.
class Point {
  x = 1;
}
const point = await new Point();
console.log(point.x, await 2, await "text", await undefined);
Array.prototype.push = function () {};
/* Build errors:
error: TS100014: this assignment always throws: built-in objects are read-only in a compiled executable
*/
