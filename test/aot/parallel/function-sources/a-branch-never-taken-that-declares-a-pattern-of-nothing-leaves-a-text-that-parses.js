function listOfNothing(list) { const v = 1; if (false) var [] = list; return v; }
function objectOfNothing(object) { const v = 2; if (false) var {} = object; return v; }
function bothBesideAName(list) { const v = 3; if (false) var [] = list, kept = 1, {} = list; return [v, kept]; }
function inABlock(list) { const v = 4; if (false) { var [] = list; } return v; }
function inTheOtherBranch(list) { const v = 5; if (true) v; else var [[], {}] = list; return v; }
function inTheHeadOfALoop(list) { const v = 6; if (false) for (var [] of list) ; return v; }
for (const asked of [listOfNothing, objectOfNothing, bothBesideAName, inABlock, inTheOtherBranch, inTheHeadOfALoop]) {
  try {
    console.log(asked.name, String(new Function("return (" + String(asked) + "\n)")()([])));
  } catch (error) {
    console.log(asked.name, error.name);
  }
}
