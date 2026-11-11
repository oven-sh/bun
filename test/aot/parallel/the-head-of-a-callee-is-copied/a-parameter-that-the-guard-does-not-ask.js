class Box { constructor(width, height) { this.cached = ""; this.width = width; this.height = height; } }
function make(width, height) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new Box(width, height + work - 1); }
function cachedOf(box, unit) {
  if (box.cached) return box.cached;
  let sum = 0;
  for (let i = 0; i < box.height; i++) sum = (sum + box.width * box.height + i) | 0;
  box.cached = typeof unit + ":" + sum;
  return box.cached;
}
function guarded(box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; try { return cachedOf(box, 7); } catch (error) { return error.name; } }
function plain(box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const answer = cachedOf(box, "text"); return answer + "!"; }
console.log(guarded(make(1, 2)));
console.log(plain(make(3, 4)));
console.log(plain(JSON.parse('{"cached":"","width":5,"height":6}')));
