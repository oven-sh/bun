// ───────────── ESLint's code path analysis ─────────────

// `enter` and `leave` call the listeners for the node with a number.
class CodePathAnalyzer {
  constructor(enter, leave) {
    this.enter = enter;
    this.leave = leave;
    throw new Error("Code path analysis is not supported yet.");
  }
  enterNode(node, id) {
    this.enter(id);
  }
  leaveNode(node, id) {
    this.leave(id);
  }
}
