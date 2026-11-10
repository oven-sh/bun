const defaults = { color: "blue", size: 2, shown: true };
function merged(given) {
  return { ...defaults, ...given };
}
const settings = merged(JSON.parse('{"size":5}'));
console.log(settings.color, settings.size, JSON.stringify(settings));
