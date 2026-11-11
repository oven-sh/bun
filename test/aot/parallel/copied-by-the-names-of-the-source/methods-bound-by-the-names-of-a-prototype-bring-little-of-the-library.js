// STATISTIC: ImageFunctionsEmitted <= 40
function Made() {}
Made.prototype.say = function () {
  return `made ${this.word}`;
};
function start(made) {
  const proto = Made.prototype;
  for (const key in proto) {
    if (!Object.prototype.hasOwnProperty.call(proto, key)) continue;
    if (!(key in made)) made[key] = proto[key].bind(made);
  }
  return made;
}
const { say } = start({ word: "up" });
console.log(say());
