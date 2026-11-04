class Odd { get toJSON() { return () => "by a getter"; } }
console.log(JSON.stringify([new Odd()]));
