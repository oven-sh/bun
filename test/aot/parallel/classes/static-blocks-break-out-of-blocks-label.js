// Static blocks of classes label blocks of their own and leave them with a break. Plain Bun prints another output.
const lines = [];
class LeavesABlock {
  static {
    block: {
      lines.push("in the block");
      if (lines.length > 0) break block;
      lines.push("behind the break");
    }
    lines.push("behind the block");
  }
}
class LeavesTheInnerOfTwo {
  static {
    outer: inner: {
      lines.push("in both");
      if (lines.length > 0) break inner;
      lines.push("behind the break");
    }
    lines.push("behind both");
  }
}
class LeavesTheOuterOfTwo {
  static {
    outer: {
      inner: {
        lines.push("in the inner one");
        if (lines.length > 0) break outer;
        lines.push("behind the break");
      }
      lines.push("behind the inner one");
    }
    lines.push("behind the outer one");
  }
}
class RunsAFinally {
  static {
    block: {
      try {
        if (lines.length > 0) break block;
      } finally {
        lines.push("finally");
      }
      lines.push("behind the try");
    }
  }
}
class LeavesABlockFromALoop {
  static {
    block: {
      for (const item of [1, 2, 3]) {
        lines.push("item " + item);
        if (item === 2) break block;
      }
      lines.push("behind the loop");
    }
  }
}
console.log(lines.join("\n"));
console.log(
  [LeavesABlock, LeavesTheInnerOfTwo, LeavesTheOuterOfTwo, RunsAFinally, LeavesABlockFromALoop]
    .map(made => made.name)
    .join(),
);
/* Output:
in the block
behind the block
in both
behind both
in the inner one
behind the outer one
finally
item 1
item 2
LeavesABlock,LeavesTheInnerOfTwo,LeavesTheOuterOfTwo,RunsAFinally,LeavesABlockFromALoop
*/
