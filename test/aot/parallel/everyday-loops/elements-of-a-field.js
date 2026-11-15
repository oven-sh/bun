// The list is a field of an object whose method pushes onto another
class Score {
  constructor(points) {
    this.points = points;
  }
  rounds(bonus) {
    const all = [];
    for (let round = 0; round < 3; round++) {
      for (let player = 0; player < 2; player++) all.push(this.points[player] + bonus);
      all.push(this.points[round]);
    }
    return all;
  }
}
console.log(new Score([1, 2, 3]).rounds(0).join());
console.log(new Score([10, 20, 30]).rounds(1).join());
console.log(new Score([7, 8, 9]).rounds(-5).join(), new Score([4, 5, 6]).rounds(100).length);
