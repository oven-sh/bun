// STATISTIC: AbsenceTestedVariableReadsHoisted >= 1
class Box {
  static #held;
  static lay(value) {
    Box.#held = value;
  }
  static peek() {
    return Box.#held;
  }
  static work() {
    let total = 0;
    for (let turn = 0; turn < Number("3"); turn++) {
      if (Box.#held) total = total * 3 + (Box.#held.step);
      else total = total * 3 + (-1);
    }
    return total;
  }
  static attempt() {
    try {
      return Box.work();
    } catch (error) {
      return error.constructor.name;
    }
  }
  static first = Box.attempt();
}
console.log("SAID first " + Box.first);
Box.lay({ step: 9 });
console.log("SAID second " + Box.attempt());
console.log("SAID holds " + typeof Box.peek());
