// A loop adds to a field on every turn, and behind a test that few objects pass a helper adds to the same field. Now and then the field is written under another name.
class Plain {
  count = 1;
  steps = 0;
}
class Heir extends Plain {
  extra = 3;
}

function addExtra(object) {
  object.count = (object.count + object.extra) | 0;
}
function addExtraTwice(object) {
  addExtra(object);
  addExtra(object);
}
function addExtraAsNumber(object) {
  object.count = object.count + object.extra;
}
function addExtraAndStep(object) {
  object.count = (object.count + object.extra) | 0;
  object.steps = (object.steps + 1) | 0;
}

function countUp(holder, other, turns, when) {
  for (let turn = 0; turn < turns; turn++) {
    if (turn === when) other.count = turn;
    holder.count = (holder.count + 1) | 0;
    if (holder instanceof Heir) addExtra(holder);
  }
  return holder.count + ":" + other.count;
}

function countDown(holder, other, turns, when) {
  for (let turn = turns; turn > 0; turn--) {
    if (turn === when) other.count = turn;
    holder.count = (holder.count + 1) | 0;
    if (holder instanceof Heir) addExtra(holder);
  }
  return holder.count + ":" + other.count;
}

function countFromBothEnds(holder, other, turns, when) {
  for (let low = 0, high = turns; low < high; low++, high--) {
    if (low === when) other.count = high;
    holder.count = (holder.count + 1) | 0;
    if (holder instanceof Heir) addExtra(holder);
  }
  return holder.count + ":" + other.count;
}

function countHalves(holder, other, turns, when) {
  for (let turn = 0; turn < turns; turn++) {
    if (turn === when) other.count = turn;
    holder.count = holder.count + 0.5;
    if (holder instanceof Heir) addExtraAsNumber(holder);
  }
  return holder.count + ":" + other.count;
}

function countUnderHandler(holder, other, turns, when) {
  try {
    for (let turn = 0; turn < turns; turn++) {
      if (turn === when) other.count = turn * 2;
      holder.count = (holder.count + 1) | 0;
      if (holder instanceof Heir) addExtra(holder);
    }
  } catch {
    return "caught";
  }
  return holder.count + ":" + other.count;
}

function countUntilSix(holder, other, turns, when) {
  for (let turn = 0; turn < turns; turn++) {
    if (turn === when) other.count = turn + 1;
    holder.count = (holder.count + 1) | 0;
    if (holder instanceof Heir) addExtra(holder);
    if (holder.count > 6) break;
  }
  return holder.count + ":" + other.count;
}

function countTwoFields(holder, other, turns, when) {
  for (let turn = 0; turn < turns; turn++) {
    if (turn === when) other.count = turn;
    holder.count = (holder.count + 1) | 0;
    holder.steps = (holder.steps + 2) | 0;
    if (holder instanceof Heir) addExtraAndStep(holder);
  }
  return holder.count + ":" + other.count + ":" + holder.steps;
}

function countInRounds(holder, other, turns, when) {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < turns; turn++) {
      if (turn === when) other.count = turn;
      holder.count = (holder.count + 1) | 0;
      if (holder instanceof Heir) addExtraTwice(holder);
    }
  }
  return holder.count + ":" + other.count;
}

// The other name is always that of a plain object: in the first and the third call of the very one that is counted in.
{
  const one = new Plain();
  console.log("countUp", countUp(one, one, JSON.parse("3"), 3), countUp(new Heir(), new Plain(), JSON.parse("4"), 3), countUp(one, one, JSON.parse("5"), 2));
}
{
  const one = new Plain();
  console.log("countDown", countDown(one, one, JSON.parse("3"), 3), countDown(new Heir(), new Plain(), JSON.parse("4"), 3), countDown(one, one, JSON.parse("5"), 2));
}
{
  const one = new Plain();
  console.log("countFromBothEnds", countFromBothEnds(one, one, JSON.parse("3"), 3), countFromBothEnds(new Heir(), new Plain(), JSON.parse("4"), 3), countFromBothEnds(one, one, JSON.parse("5"), 2));
}
{
  const one = new Plain();
  console.log("countHalves", countHalves(one, one, JSON.parse("3"), 3), countHalves(new Heir(), new Plain(), JSON.parse("4"), 3), countHalves(one, one, JSON.parse("5"), 2));
}
{
  const one = new Plain();
  console.log("countUnderHandler", countUnderHandler(one, one, JSON.parse("3"), 3), countUnderHandler(new Heir(), new Plain(), JSON.parse("4"), 3), countUnderHandler(one, one, JSON.parse("5"), 2));
}
{
  const one = new Plain();
  console.log("countUntilSix", countUntilSix(one, one, JSON.parse("3"), 3), countUntilSix(new Heir(), new Plain(), JSON.parse("4"), 3), countUntilSix(one, one, JSON.parse("5"), 2));
}
{
  const one = new Plain();
  console.log("countTwoFields", countTwoFields(one, one, JSON.parse("3"), 3), countTwoFields(new Heir(), new Plain(), JSON.parse("4"), 3), countTwoFields(one, one, JSON.parse("5"), 2));
}
{
  const one = new Plain();
  console.log("countInRounds", countInRounds(one, one, JSON.parse("3"), 3), countInRounds(new Heir(), new Plain(), JSON.parse("4"), 3), countInRounds(one, one, JSON.parse("5"), 2));
}
