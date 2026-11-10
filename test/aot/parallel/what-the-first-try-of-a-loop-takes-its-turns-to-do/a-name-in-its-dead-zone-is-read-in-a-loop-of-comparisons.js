function run(early) {
  let turns = null,
    said = "";
  try {
    while (turns === null) {
      turns = [turns];
      if (early === true) said = late === null ? "null" : "other";
    }
    said = said + "|through";
  } catch (e) {
    said = e.constructor.name + "|" + JSON.stringify(turns);
  }
  let late = null;
  return said + "|" + (late === null);
}
console.log(run(false), run(true));
