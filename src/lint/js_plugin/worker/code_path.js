// ───────────── ESLint's code path analysis ─────────────
//
// `lib/linter/code-path-analysis` of ESLint, without what is there for debugging: the same identifiers, the same graphs and
// the same events in the same order. Each part is in a scope of its own, as it is in a module of its own there.
//
// The events of the native analysis (src/lint/code_path) cannot be replayed in its place: a rule also sees between which nodes of
// the ESTree an event falls and which node comes with it, and the native walk has no node for a dozen kinds of them. This is
// ESLint's algorithm on ESLint's tree. test/cli/lint/oracle/jsplugins/code_path compares all that a rule can see of it.

const breakableTypePattern = /^(?:(?:Do)?While|For(?:In|Of)?|Switch)Statement$/u;

const IdGenerator = (() => {
  class IdGenerator {
    constructor(prefix) {
      this.prefix = String(prefix);
      this.n = 0;
    }

    next() {
      this.n = (1 + this.n) | 0;

      if (this.n < 0) {
        this.n = 1;
      }

      return this.prefix + this.n;
    }
  }

  return IdGenerator;
})();

const CodePathSegment = (() => {
  function isReachable(segment) {
    return segment.reachable;
  }

  class CodePathSegment {
    constructor(id, allPrevSegments, reachable) {
      this.id = id;

      this.nextSegments = [];

      this.prevSegments = allPrevSegments.filter(isReachable);

      this.allNextSegments = [];

      this.allPrevSegments = allPrevSegments;

      this.reachable = reachable;

      Object.defineProperty(this, "internal", {
        value: {
          used: false,

          loopedPrevSegments: [],
        },
      });
    }

    isLoopedPrevSegment(segment) {
      return this.internal.loopedPrevSegments.includes(segment);
    }

    static newRoot(id) {
      return new CodePathSegment(id, [], true);
    }

    static newNext(id, allPrevSegments) {
      return new CodePathSegment(
        id,
        CodePathSegment.flattenUnusedSegments(allPrevSegments),
        allPrevSegments.some(isReachable),
      );
    }

    static newUnreachable(id, allPrevSegments) {
      const segment = new CodePathSegment(id, CodePathSegment.flattenUnusedSegments(allPrevSegments), false);

      CodePathSegment.markUsed(segment);

      return segment;
    }

    static newDisconnected(id, allPrevSegments) {
      return new CodePathSegment(id, [], allPrevSegments.some(isReachable));
    }

    static markUsed(segment) {
      if (segment.internal.used) {
        return;
      }
      segment.internal.used = true;

      let i;

      if (segment.reachable) {
        for (i = 0; i < segment.allPrevSegments.length; ++i) {
          const prevSegment = segment.allPrevSegments[i];

          prevSegment.allNextSegments.push(segment);
          prevSegment.nextSegments.push(segment);
        }
      } else {
        for (i = 0; i < segment.allPrevSegments.length; ++i) {
          segment.allPrevSegments[i].allNextSegments.push(segment);
        }
      }
    }

    static markPrevSegmentAsLooped(segment, prevSegment) {
      segment.internal.loopedPrevSegments.push(prevSegment);
    }

    static flattenUnusedSegments(segments) {
      const done = new Set();

      for (let i = 0; i < segments.length; ++i) {
        const segment = segments[i];

        if (done.has(segment)) {
          continue;
        }

        if (!segment.internal.used) {
          for (let j = 0; j < segment.allPrevSegments.length; ++j) {
            const prevSegment = segment.allPrevSegments[j];

            if (!done.has(prevSegment)) {
              done.add(prevSegment);
            }
          }
        } else {
          done.add(segment);
        }
      }

      return [...done];
    }
  }

  return CodePathSegment;
})();

const ForkContext = (() => {
  function isReachable(segment) {
    return segment.reachable;
  }

  function createSegments(context, startIndex, endIndex, create) {
    const list = context.segmentsList;

    const normalizedBegin = startIndex >= 0 ? startIndex : list.length + startIndex;
    const normalizedEnd = endIndex >= 0 ? endIndex : list.length + endIndex;

    const segments = [];

    for (let i = 0; i < context.count; ++i) {
      const allPrevSegments = [];

      for (let j = normalizedBegin; j <= normalizedEnd; ++j) {
        allPrevSegments.push(list[j][i]);
      }

      segments.push(create(context.idGenerator.next(), allPrevSegments));
    }

    return segments;
  }

  function mergeExtraSegments(context, segments) {
    let currentSegments = segments;

    while (currentSegments.length > context.count) {
      const merged = [];

      for (let i = 0, length = Math.floor(currentSegments.length / 2); i < length; ++i) {
        merged.push(
          CodePathSegment.newNext(context.idGenerator.next(), [currentSegments[i], currentSegments[i + length]]),
        );
      }

      currentSegments = merged;
    }

    return currentSegments;
  }

  class ForkContext {
    constructor(idGenerator, upper, count) {
      this.idGenerator = idGenerator;

      this.upper = upper;

      this.count = count;

      this.segmentsList = [];
    }

    get head() {
      const list = this.segmentsList;

      return list.length === 0 ? [] : list.at(-1);
    }

    get empty() {
      return this.segmentsList.length === 0;
    }

    get reachable() {
      const segments = this.head;

      return segments.length > 0 && segments.some(isReachable);
    }

    makeNext(startIndex, endIndex) {
      return createSegments(this, startIndex, endIndex, CodePathSegment.newNext);
    }

    makeUnreachable(startIndex, endIndex) {
      return createSegments(this, startIndex, endIndex, CodePathSegment.newUnreachable);
    }

    makeDisconnected(startIndex, endIndex) {
      return createSegments(this, startIndex, endIndex, CodePathSegment.newDisconnected);
    }

    add(segments) {
      assert(segments.length >= this.count, `${segments.length} >= ${this.count}`);
      this.segmentsList.push(mergeExtraSegments(this, segments));
    }

    replaceHead(replacementHeadSegments) {
      assert(replacementHeadSegments.length >= this.count, `${replacementHeadSegments.length} >= ${this.count}`);
      this.segmentsList.splice(-1, 1, mergeExtraSegments(this, replacementHeadSegments));
    }

    addAll(otherForkContext) {
      assert(otherForkContext.count === this.count);
      this.segmentsList.push(...otherForkContext.segmentsList);
    }

    clear() {
      this.segmentsList = [];
    }

    static newRoot(idGenerator) {
      const context = new ForkContext(idGenerator, null, 1);

      context.add([CodePathSegment.newRoot(idGenerator.next())]);

      return context;
    }

    static newEmpty(parentContext, shouldForkLeavingPath) {
      return new ForkContext(
        parentContext.idGenerator,
        parentContext,
        (shouldForkLeavingPath ? 2 : 1) * parentContext.count,
      );
    }
  }

  return ForkContext;
})();

const CodePathState = (() => {
  class BreakContext {
    constructor(upperContext, breakable, label, forkContext) {
      this.upper = upperContext;

      this.breakable = breakable;

      this.label = label;

      this.brokenForkContext = ForkContext.newEmpty(forkContext);
    }
  }

  class ChainContext {
    constructor(upperContext) {
      this.upper = upperContext;

      this.choiceContextCount = 0;
    }
  }

  class ChoiceContext {
    constructor(upperContext, kind, isForkingAsResult, forkContext) {
      this.upper = upperContext;

      this.kind = kind;

      this.isForkingAsResult = isForkingAsResult;

      this.trueForkContext = ForkContext.newEmpty(forkContext);

      this.falseForkContext = ForkContext.newEmpty(forkContext);

      this.nullishForkContext = ForkContext.newEmpty(forkContext);

      this.processed = false;
    }
  }

  class LoopContextBase {
    constructor(upperContext, type, label, breakContext) {
      this.upper = upperContext;

      this.type = type;

      this.label = label;

      this.brokenForkContext = breakContext.brokenForkContext;
    }
  }

  class WhileLoopContext extends LoopContextBase {
    constructor(upperContext, label, breakContext) {
      super(upperContext, "WhileStatement", label, breakContext);

      this.test = void 0;

      this.continueDestSegments = null;
    }
  }

  class DoWhileLoopContext extends LoopContextBase {
    constructor(upperContext, label, breakContext, forkContext) {
      super(upperContext, "DoWhileStatement", label, breakContext);

      this.test = void 0;

      this.entrySegments = null;

      this.continueForkContext = ForkContext.newEmpty(forkContext);
    }
  }

  class ForLoopContext extends LoopContextBase {
    constructor(upperContext, label, breakContext) {
      super(upperContext, "ForStatement", label, breakContext);

      this.test = void 0;

      this.endOfInitSegments = null;

      this.testSegments = null;

      this.endOfTestSegments = null;

      this.updateSegments = null;

      this.endOfUpdateSegments = null;

      this.continueDestSegments = null;
    }
  }

  class ForInLoopContext extends LoopContextBase {
    constructor(upperContext, label, breakContext) {
      super(upperContext, "ForInStatement", label, breakContext);

      this.prevSegments = null;

      this.leftSegments = null;

      this.endOfLeftSegments = null;

      this.continueDestSegments = null;
    }
  }

  class ForOfLoopContext extends LoopContextBase {
    constructor(upperContext, label, breakContext) {
      super(upperContext, "ForOfStatement", label, breakContext);

      this.prevSegments = null;

      this.leftSegments = null;

      this.endOfLeftSegments = null;

      this.continueDestSegments = null;
    }
  }

  class SwitchContext {
    constructor(upperContext, hasCase) {
      this.upper = upperContext;

      this.hasCase = hasCase;

      this.defaultSegments = null;

      this.defaultBodySegments = null;

      this.foundEmptyDefault = false;

      this.lastIsDefault = false;

      this.forkCount = 0;
    }
  }

  class TryContext {
    constructor(upperContext, hasFinalizer, forkContext) {
      this.upper = upperContext;

      this.hasFinalizer = hasFinalizer;

      this.position = "try";

      this.returnedForkContext = hasFinalizer ? ForkContext.newEmpty(forkContext) : null;

      this.thrownForkContext = ForkContext.newEmpty(forkContext);

      this.lastOfTryIsReachable = false;

      this.lastOfCatchIsReachable = false;
    }
  }

  function addToReturnedOrThrown(dest, others, all, segments) {
    for (let i = 0; i < segments.length; ++i) {
      const segment = segments[i];

      dest.push(segment);
      if (!others.includes(segment)) {
        all.push(segment);
      }
    }
  }

  function getContinueContext(state, label) {
    if (!label) {
      return state.loopContext;
    }

    let context = state.loopContext;

    while (context) {
      if (context.label === label) {
        return context;
      }
      context = context.upper;
    }

    return null;
  }

  function getBreakContext(state, label) {
    let context = state.breakContext;

    while (context) {
      if (label ? context.label === label : context.breakable) {
        return context;
      }
      context = context.upper;
    }

    return null;
  }

  function getReturnContext(state) {
    let context = state.tryContext;

    while (context) {
      if (context.hasFinalizer && context.position !== "finally") {
        return context;
      }
      context = context.upper;
    }

    return state;
  }

  function getThrowContext(state) {
    let context = state.tryContext;

    while (context) {
      if (context.position === "try" || (context.hasFinalizer && context.position === "catch")) {
        return context;
      }
      context = context.upper;
    }

    return state;
  }

  function removeFromArray(elements, value) {
    elements.splice(elements.indexOf(value), 1);
  }

  function disconnectSegments(prevSegments, nextSegments) {
    for (let i = 0; i < prevSegments.length; ++i) {
      const prevSegment = prevSegments[i];
      const nextSegment = nextSegments[i];

      removeFromArray(prevSegment.nextSegments, nextSegment);
      removeFromArray(prevSegment.allNextSegments, nextSegment);
      removeFromArray(nextSegment.prevSegments, prevSegment);
      removeFromArray(nextSegment.allPrevSegments, prevSegment);
    }
  }

  function makeLooped(state, unflattenedFromSegments, unflattenedToSegments) {
    const fromSegments = CodePathSegment.flattenUnusedSegments(unflattenedFromSegments);
    const toSegments = CodePathSegment.flattenUnusedSegments(unflattenedToSegments);
    const end = Math.min(fromSegments.length, toSegments.length);

    for (let i = 0; i < end; ++i) {
      const fromSegment = fromSegments[i];
      const toSegment = toSegments[i];

      if (toSegment.reachable) {
        fromSegment.nextSegments.push(toSegment);
      }

      if (fromSegment.reachable) {
        toSegment.prevSegments.push(fromSegment);
      }

      fromSegment.allNextSegments.push(toSegment);
      toSegment.allPrevSegments.push(fromSegment);

      if (toSegment.allPrevSegments.length >= 2) {
        CodePathSegment.markPrevSegmentAsLooped(toSegment, fromSegment);
      }

      state.notifyLooped(fromSegment, toSegment);
    }
  }

  function finalizeTestSegmentsOfFor(context, choiceContext, head) {
    if (!choiceContext.processed) {
      choiceContext.trueForkContext.add(head);
      choiceContext.falseForkContext.add(head);
      choiceContext.nullishForkContext.add(head);
    }

    if (context.test !== true) {
      context.brokenForkContext.addAll(choiceContext.falseForkContext);
    }

    context.endOfTestSegments = choiceContext.trueForkContext.makeNext(0, -1);
  }

  class CodePathState {
    constructor(idGenerator, onLooped) {
      this.idGenerator = idGenerator;

      this.notifyLooped = onLooped;

      this.forkContext = ForkContext.newRoot(idGenerator);

      this.choiceContext = null;

      this.switchContext = null;

      this.tryContext = null;

      this.loopContext = null;

      this.breakContext = null;

      this.chainContext = null;

      this.currentSegments = [];

      this.initialSegment = this.forkContext.head[0];

      this.finalSegments = [];

      this.returnedForkContext = [];

      this.thrownForkContext = [];

      const final = this.finalSegments;
      const returned = this.returnedForkContext;
      const thrown = this.thrownForkContext;

      returned.add = addToReturnedOrThrown.bind(null, returned, thrown, final);
      thrown.add = addToReturnedOrThrown.bind(null, thrown, returned, final);
    }

    get headSegments() {
      return this.forkContext.head;
    }

    get parentForkContext() {
      const current = this.forkContext;

      return current && current.upper;
    }

    pushForkContext(forkLeavingPath) {
      this.forkContext = ForkContext.newEmpty(this.forkContext, forkLeavingPath);

      return this.forkContext;
    }

    popForkContext() {
      const lastContext = this.forkContext;

      this.forkContext = lastContext.upper;
      this.forkContext.replaceHead(lastContext.makeNext(0, -1));

      return lastContext;
    }

    forkPath() {
      this.forkContext.add(this.parentForkContext.makeNext(-1, -1));
    }

    forkBypassPath() {
      this.forkContext.add(this.parentForkContext.head);
    }

    pushChoiceContext(kind, isForkingAsResult) {
      this.choiceContext = new ChoiceContext(this.choiceContext, kind, isForkingAsResult, this.forkContext);
    }

    popChoiceContext() {
      const poppedChoiceContext = this.choiceContext;
      const forkContext = this.forkContext;
      const head = forkContext.head;

      this.choiceContext = poppedChoiceContext.upper;

      switch (poppedChoiceContext.kind) {
        case "&&":
        case "||":
        case "??":
          if (!poppedChoiceContext.processed) {
            poppedChoiceContext.trueForkContext.add(head);
            poppedChoiceContext.falseForkContext.add(head);
            poppedChoiceContext.nullishForkContext.add(head);
          }

          if (poppedChoiceContext.isForkingAsResult) {
            const parentContext = this.choiceContext;

            parentContext.trueForkContext.addAll(poppedChoiceContext.trueForkContext);
            parentContext.falseForkContext.addAll(poppedChoiceContext.falseForkContext);
            parentContext.nullishForkContext.addAll(poppedChoiceContext.nullishForkContext);
            parentContext.processed = true;

            return poppedChoiceContext;
          }

          break;

        case "test":
          if (!poppedChoiceContext.processed) {
            poppedChoiceContext.trueForkContext.clear();
            poppedChoiceContext.trueForkContext.add(head);
          } else {
            poppedChoiceContext.falseForkContext.clear();
            poppedChoiceContext.falseForkContext.add(head);
          }

          break;

        case "loop":
          return poppedChoiceContext;

        default:
          throw new Error("unreachable");
      }

      const combinedForkContext = poppedChoiceContext.trueForkContext;

      combinedForkContext.addAll(poppedChoiceContext.falseForkContext);
      forkContext.replaceHead(combinedForkContext.makeNext(0, -1));

      return poppedChoiceContext;
    }

    makeLogicalRight() {
      const currentChoiceContext = this.choiceContext;
      const forkContext = this.forkContext;

      if (currentChoiceContext.processed) {
        let prevForkContext;

        switch (currentChoiceContext.kind) {
          case "&&":
            prevForkContext = currentChoiceContext.trueForkContext;
            break;
          case "||":
            prevForkContext = currentChoiceContext.falseForkContext;
            break;
          case "??":
            prevForkContext = currentChoiceContext.nullishForkContext;
            break;
          default:
            throw new Error("unreachable");
        }

        forkContext.replaceHead(prevForkContext.makeNext(0, -1));

        prevForkContext.clear();
        currentChoiceContext.processed = false;
      } else {
        switch (currentChoiceContext.kind) {
          case "&&":
            currentChoiceContext.falseForkContext.add(forkContext.head);
            currentChoiceContext.nullishForkContext.add(forkContext.head);
            break;
          case "||":
            currentChoiceContext.trueForkContext.add(forkContext.head);
            break;
          case "??":
            currentChoiceContext.trueForkContext.add(forkContext.head);
            currentChoiceContext.falseForkContext.add(forkContext.head);
            break;
          default:
            throw new Error("unreachable");
        }

        forkContext.replaceHead(forkContext.makeNext(-1, -1));
      }
    }

    makeIfConsequent() {
      const context = this.choiceContext;
      const forkContext = this.forkContext;

      if (!context.processed) {
        context.trueForkContext.add(forkContext.head);
        context.falseForkContext.add(forkContext.head);
        context.nullishForkContext.add(forkContext.head);
      }

      context.processed = false;

      forkContext.replaceHead(context.trueForkContext.makeNext(0, -1));
    }

    makeIfAlternate() {
      const context = this.choiceContext;
      const forkContext = this.forkContext;

      context.trueForkContext.clear();
      context.trueForkContext.add(forkContext.head);
      context.processed = true;

      forkContext.replaceHead(context.falseForkContext.makeNext(0, -1));
    }

    pushChainContext() {
      this.chainContext = new ChainContext(this.chainContext);
    }

    popChainContext() {
      const context = this.chainContext;

      this.chainContext = context.upper;

      for (let i = context.choiceContextCount; i > 0; --i) {
        this.popChoiceContext();
      }
    }

    makeOptionalNode() {
      if (this.chainContext) {
        this.chainContext.choiceContextCount += 1;
        this.pushChoiceContext("??", false);
      }
    }

    makeOptionalRight() {
      if (this.chainContext) {
        this.makeLogicalRight();
      }
    }

    pushSwitchContext(hasCase, label) {
      this.switchContext = new SwitchContext(this.switchContext, hasCase);
      this.pushBreakContext(true, label);
    }

    popSwitchContext() {
      const context = this.switchContext;

      this.switchContext = context.upper;

      const forkContext = this.forkContext;
      const brokenForkContext = this.popBreakContext().brokenForkContext;

      if (context.forkCount === 0) {
        if (!brokenForkContext.empty) {
          brokenForkContext.add(forkContext.makeNext(-1, -1));
          forkContext.replaceHead(brokenForkContext.makeNext(0, -1));
        }

        return;
      }

      const lastSegments = forkContext.head;

      this.forkBypassPath();
      const lastCaseSegments = forkContext.head;

      brokenForkContext.add(lastSegments);

      if (!context.lastIsDefault) {
        if (context.defaultBodySegments) {
          disconnectSegments(context.defaultSegments, context.defaultBodySegments);

          makeLooped(this, lastCaseSegments, context.defaultBodySegments);
        } else {
          brokenForkContext.add(lastCaseSegments);
        }
      }

      for (let i = 0; i < context.forkCount; ++i) {
        this.forkContext = this.forkContext.upper;
      }

      this.forkContext.replaceHead(brokenForkContext.makeNext(0, -1));
    }

    makeSwitchCaseBody(isCaseBodyEmpty, isDefaultCase) {
      const context = this.switchContext;

      if (!context.hasCase) {
        return;
      }

      const parentForkContext = this.forkContext;
      const forkContext = this.pushForkContext();

      forkContext.add(parentForkContext.makeNext(0, -1));

      if (isDefaultCase) {
        context.defaultSegments = parentForkContext.head;

        if (isCaseBodyEmpty) {
          context.foundEmptyDefault = true;
        } else {
          context.defaultBodySegments = forkContext.head;
        }
      } else {
        if (!isCaseBodyEmpty && context.foundEmptyDefault) {
          context.foundEmptyDefault = false;
          context.defaultBodySegments = forkContext.head;
        }
      }

      context.lastIsDefault = isDefaultCase;
      context.forkCount += 1;
    }

    pushTryContext(hasFinalizer) {
      this.tryContext = new TryContext(this.tryContext, hasFinalizer, this.forkContext);
    }

    popTryContext() {
      const context = this.tryContext;

      this.tryContext = context.upper;

      if (context.position === "catch") {
        this.popForkContext();
        return;
      }

      const originalReturnedForkContext = context.returnedForkContext;
      const originalThrownForkContext = context.thrownForkContext;

      if (originalReturnedForkContext.empty && originalThrownForkContext.empty) {
        return;
      }

      const headSegments = this.forkContext.head;

      this.forkContext = this.forkContext.upper;
      const normalSegments = headSegments.slice(0, (headSegments.length / 2) | 0);
      const leavingSegments = headSegments.slice((headSegments.length / 2) | 0);

      if (!originalReturnedForkContext.empty) {
        getReturnContext(this).returnedForkContext.add(leavingSegments);
      }
      if (!originalThrownForkContext.empty) {
        getThrowContext(this).thrownForkContext.add(leavingSegments);
      }

      this.forkContext.replaceHead(normalSegments);

      if (!context.lastOfTryIsReachable && !context.lastOfCatchIsReachable) {
        this.forkContext.makeUnreachable();
      }
    }

    makeCatchBlock() {
      const context = this.tryContext;
      const forkContext = this.forkContext;
      const originalThrownForkContext = context.thrownForkContext;

      context.position = "catch";
      context.thrownForkContext = ForkContext.newEmpty(forkContext);
      context.lastOfTryIsReachable = forkContext.reachable;

      originalThrownForkContext.add(forkContext.head);
      const thrownSegments = originalThrownForkContext.makeNext(0, -1);

      this.pushForkContext();
      this.forkBypassPath();
      this.forkContext.add(thrownSegments);
    }

    makeFinallyBlock() {
      const context = this.tryContext;
      let forkContext = this.forkContext;
      const originalReturnedForkContext = context.returnedForkContext;
      const originalThrownForContext = context.thrownForkContext;
      const headOfLeavingSegments = forkContext.head;

      if (context.position === "catch") {
        this.popForkContext();
        forkContext = this.forkContext;

        context.lastOfCatchIsReachable = forkContext.reachable;
      } else {
        context.lastOfTryIsReachable = forkContext.reachable;
      }

      context.position = "finally";

      if (originalReturnedForkContext.empty && originalThrownForContext.empty) {
        return;
      }

      const segments = forkContext.makeNext(-1, -1);

      for (let i = 0; i < forkContext.count; ++i) {
        const prevSegsOfLeavingSegment = [headOfLeavingSegments[i]];

        for (let j = 0; j < originalReturnedForkContext.segmentsList.length; ++j) {
          prevSegsOfLeavingSegment.push(originalReturnedForkContext.segmentsList[j][i]);
        }
        for (let j = 0; j < originalThrownForContext.segmentsList.length; ++j) {
          prevSegsOfLeavingSegment.push(originalThrownForContext.segmentsList[j][i]);
        }

        segments.push(CodePathSegment.newNext(this.idGenerator.next(), prevSegsOfLeavingSegment));
      }

      this.pushForkContext(true);
      this.forkContext.add(segments);
    }

    makeYield() {
      const forkContext = this.forkContext;
      const leavingSegments = forkContext.head;

      if (forkContext.reachable) {
        getReturnContext(this).returnedForkContext.add(leavingSegments);
        getThrowContext(this).thrownForkContext.add(leavingSegments);

        forkContext.replaceHead(forkContext.makeNext(-1, -1));
      }
    }

    makeFirstThrowablePathInTryOrCatchBlock() {
      const forkContext = this.forkContext;

      if (!forkContext.reachable) {
        return;
      }

      const context = getThrowContext(this);

      if (context === this || !context.thrownForkContext.empty) {
        return;
      }

      if (context.position !== "try" && (context.position !== "catch" || !context.hasFinalizer)) {
        return;
      }

      context.thrownForkContext.add(forkContext.head);
      forkContext.replaceHead(forkContext.makeNext(-1, -1));
    }

    pushLoopContext(type, label) {
      const forkContext = this.forkContext;

      const breakContext = this.pushBreakContext(true, label);

      switch (type) {
        case "WhileStatement":
          this.pushChoiceContext("loop", false);
          this.loopContext = new WhileLoopContext(this.loopContext, label, breakContext);
          break;

        case "DoWhileStatement":
          this.pushChoiceContext("loop", false);
          this.loopContext = new DoWhileLoopContext(this.loopContext, label, breakContext, forkContext);
          break;

        case "ForStatement":
          this.pushChoiceContext("loop", false);
          this.loopContext = new ForLoopContext(this.loopContext, label, breakContext);
          break;

        case "ForInStatement":
          this.loopContext = new ForInLoopContext(this.loopContext, label, breakContext);
          break;

        case "ForOfStatement":
          this.loopContext = new ForOfLoopContext(this.loopContext, label, breakContext);
          break;

        default:
          throw new Error(`unknown type: "${type}"`);
      }
    }

    popLoopContext() {
      const context = this.loopContext;

      this.loopContext = context.upper;

      const forkContext = this.forkContext;
      const brokenForkContext = this.popBreakContext().brokenForkContext;

      switch (context.type) {
        case "WhileStatement":
        case "ForStatement":
          this.popChoiceContext();

          makeLooped(this, forkContext.head, context.continueDestSegments);
          break;

        case "DoWhileStatement": {
          const choiceContext = this.popChoiceContext();

          if (!choiceContext.processed) {
            choiceContext.trueForkContext.add(forkContext.head);
            choiceContext.falseForkContext.add(forkContext.head);
          }

          if (context.test !== true) {
            brokenForkContext.addAll(choiceContext.falseForkContext);
          }

          const segmentsList = choiceContext.trueForkContext.segmentsList;

          for (let i = 0; i < segmentsList.length; ++i) {
            makeLooped(this, segmentsList[i], context.entrySegments);
          }
          break;
        }

        case "ForInStatement":
        case "ForOfStatement":
          brokenForkContext.add(forkContext.head);

          makeLooped(this, forkContext.head, context.leftSegments);
          break;

        default:
          throw new Error("unreachable");
      }

      if (brokenForkContext.empty) {
        forkContext.replaceHead(forkContext.makeUnreachable(-1, -1));
      } else {
        forkContext.replaceHead(brokenForkContext.makeNext(0, -1));
      }
    }

    makeWhileTest(test) {
      const context = this.loopContext;
      const forkContext = this.forkContext;
      const testSegments = forkContext.makeNext(0, -1);

      context.test = test;
      context.continueDestSegments = testSegments;
      forkContext.replaceHead(testSegments);
    }

    makeWhileBody() {
      const context = this.loopContext;
      const choiceContext = this.choiceContext;
      const forkContext = this.forkContext;

      if (!choiceContext.processed) {
        choiceContext.trueForkContext.add(forkContext.head);
        choiceContext.falseForkContext.add(forkContext.head);
      }

      if (context.test !== true) {
        context.brokenForkContext.addAll(choiceContext.falseForkContext);
      }
      forkContext.replaceHead(choiceContext.trueForkContext.makeNext(0, -1));
    }

    makeDoWhileBody() {
      const context = this.loopContext;
      const forkContext = this.forkContext;
      const bodySegments = forkContext.makeNext(-1, -1);

      context.entrySegments = bodySegments;
      forkContext.replaceHead(bodySegments);
    }

    makeDoWhileTest(test) {
      const context = this.loopContext;
      const forkContext = this.forkContext;

      context.test = test;

      if (!context.continueForkContext.empty) {
        context.continueForkContext.add(forkContext.head);
        const testSegments = context.continueForkContext.makeNext(0, -1);

        forkContext.replaceHead(testSegments);
      }
    }

    makeForTest(test) {
      const context = this.loopContext;
      const forkContext = this.forkContext;
      const endOfInitSegments = forkContext.head;
      const testSegments = forkContext.makeNext(-1, -1);

      context.test = test;
      context.endOfInitSegments = endOfInitSegments;
      context.continueDestSegments = context.testSegments = testSegments;
      forkContext.replaceHead(testSegments);
    }

    makeForUpdate() {
      const context = this.loopContext;
      const choiceContext = this.choiceContext;
      const forkContext = this.forkContext;

      if (context.testSegments) {
        finalizeTestSegmentsOfFor(context, choiceContext, forkContext.head);
      } else {
        context.endOfInitSegments = forkContext.head;
      }

      const updateSegments = forkContext.makeDisconnected(-1, -1);

      context.continueDestSegments = context.updateSegments = updateSegments;
      forkContext.replaceHead(updateSegments);
    }

    makeForBody() {
      const context = this.loopContext;
      const choiceContext = this.choiceContext;
      const forkContext = this.forkContext;

      if (context.updateSegments) {
        context.endOfUpdateSegments = forkContext.head;

        if (context.testSegments) {
          makeLooped(this, context.endOfUpdateSegments, context.testSegments);
        }
      } else if (context.testSegments) {
        finalizeTestSegmentsOfFor(context, choiceContext, forkContext.head);
      } else {
        context.endOfInitSegments = forkContext.head;
      }

      let bodySegments = context.endOfTestSegments;

      if (!bodySegments) {
        const prevForkContext = ForkContext.newEmpty(forkContext);

        prevForkContext.add(context.endOfInitSegments);
        if (context.endOfUpdateSegments) {
          prevForkContext.add(context.endOfUpdateSegments);
        }

        bodySegments = prevForkContext.makeNext(0, -1);
      }

      context.continueDestSegments = context.continueDestSegments || bodySegments;

      forkContext.replaceHead(bodySegments);
    }

    makeForInOfLeft() {
      const context = this.loopContext;
      const forkContext = this.forkContext;
      const leftSegments = forkContext.makeDisconnected(-1, -1);

      context.prevSegments = forkContext.head;
      context.leftSegments = context.continueDestSegments = leftSegments;
      forkContext.replaceHead(leftSegments);
    }

    makeForInOfRight() {
      const context = this.loopContext;
      const forkContext = this.forkContext;
      const temp = ForkContext.newEmpty(forkContext);

      temp.add(context.prevSegments);
      const rightSegments = temp.makeNext(-1, -1);

      context.endOfLeftSegments = forkContext.head;
      forkContext.replaceHead(rightSegments);
    }

    makeForInOfBody() {
      const context = this.loopContext;
      const forkContext = this.forkContext;
      const temp = ForkContext.newEmpty(forkContext);

      temp.add(context.endOfLeftSegments);
      const bodySegments = temp.makeNext(-1, -1);

      makeLooped(this, forkContext.head, context.leftSegments);

      context.brokenForkContext.add(forkContext.head);
      forkContext.replaceHead(bodySegments);
    }

    pushBreakContext(breakable, label) {
      this.breakContext = new BreakContext(this.breakContext, breakable, label, this.forkContext);
      return this.breakContext;
    }

    popBreakContext() {
      const context = this.breakContext;
      const forkContext = this.forkContext;

      this.breakContext = context.upper;

      if (!context.breakable) {
        const brokenForkContext = context.brokenForkContext;

        if (!brokenForkContext.empty) {
          brokenForkContext.add(forkContext.head);
          forkContext.replaceHead(brokenForkContext.makeNext(0, -1));
        }
      }

      return context;
    }

    makeBreak(label) {
      const forkContext = this.forkContext;

      if (!forkContext.reachable) {
        return;
      }

      const context = getBreakContext(this, label);

      if (context) {
        context.brokenForkContext.add(forkContext.head);
      }

      forkContext.replaceHead(forkContext.makeUnreachable(-1, -1));
    }

    makeContinue(label) {
      const forkContext = this.forkContext;

      if (!forkContext.reachable) {
        return;
      }

      const context = getContinueContext(this, label);

      if (context) {
        if (context.continueDestSegments) {
          makeLooped(this, forkContext.head, context.continueDestSegments);

          if (context.type === "ForInStatement" || context.type === "ForOfStatement") {
            context.brokenForkContext.add(forkContext.head);
          }
        } else {
          context.continueForkContext.add(forkContext.head);
        }
      }
      forkContext.replaceHead(forkContext.makeUnreachable(-1, -1));
    }

    makeReturn() {
      const forkContext = this.forkContext;

      if (forkContext.reachable) {
        getReturnContext(this).returnedForkContext.add(forkContext.head);
        forkContext.replaceHead(forkContext.makeUnreachable(-1, -1));
      }
    }

    makeThrow() {
      const forkContext = this.forkContext;

      if (forkContext.reachable) {
        getThrowContext(this).thrownForkContext.add(forkContext.head);
        forkContext.replaceHead(forkContext.makeUnreachable(-1, -1));
      }
    }

    makeFinal() {
      const segments = this.currentSegments;

      if (segments.length > 0 && segments[0].reachable) {
        this.returnedForkContext.add(segments);
      }
    }
  }

  return CodePathState;
})();

const CodePath = (() => {
  class CodePath {
    constructor({ id, origin, upper, onLooped }) {
      this.id = id;

      this.origin = origin;

      this.upper = upper;

      this.childCodePaths = [];

      Object.defineProperty(this, "internal", {
        value: new CodePathState(new IdGenerator(`${id}_`), onLooped),
      });

      if (upper) {
        upper.childCodePaths.push(this);
      }
    }

    static getState(codePath) {
      return codePath.internal;
    }

    get initialSegment() {
      return this.internal.initialSegment;
    }

    get finalSegments() {
      return this.internal.finalSegments;
    }

    get returnedSegments() {
      return this.internal.returnedForkContext;
    }

    get thrownSegments() {
      return this.internal.thrownForkContext;
    }

    traverseSegments(optionsOrCallback, callback) {
      let resolvedOptions;
      let resolvedCallback;

      if (typeof optionsOrCallback === "function") {
        resolvedCallback = optionsOrCallback;
        resolvedOptions = {};
      } else {
        resolvedOptions = optionsOrCallback || {};
        resolvedCallback = callback;
      }

      const startSegment = resolvedOptions.first || this.internal.initialSegment;
      const lastSegment = resolvedOptions.last;

      let record;
      let index;
      let end;
      let segment = null;

      const visited = new Set();

      const stack = [[startSegment, 0]];

      const skipped = new Set();

      let broken = false;

      const controller = {
        skip() {
          skipped.add(segment);
        },

        break() {
          broken = true;
        },
      };

      function isVisited(prevSegment) {
        return visited.has(prevSegment) || segment.isLoopedPrevSegment(prevSegment);
      }

      function isSkipped(prevSegment) {
        return skipped.has(prevSegment) || segment.isLoopedPrevSegment(prevSegment);
      }

      while (stack.length > 0) {
        record = stack.at(-1);
        segment = record[0];
        index = record[1];

        if (index === 0) {
          if (visited.has(segment)) {
            stack.pop();
            continue;
          }

          if (segment !== startSegment && segment.prevSegments.length > 0 && !segment.prevSegments.every(isVisited)) {
            stack.pop();
            continue;
          }

          visited.add(segment);

          const shouldSkip =
            skipped.size > 0 && segment.prevSegments.length > 0 && segment.prevSegments.every(isSkipped);

          if (!shouldSkip) {
            resolvedCallback.call(this, segment, controller);

            if (segment === lastSegment) {
              controller.skip();
            }

            if (broken) {
              break;
            }
          } else {
            skipped.add(segment);
          }
        }

        end = segment.nextSegments.length - 1;
        if (index < end) {
          record[1] += 1;
          stack.push([segment.nextSegments[index], 0]);
        } else if (index === end) {
          record[0] = segment.nextSegments[index];
          record[1] = 0;
        } else {
          stack.pop();
        }
      }
    }
  }

  return CodePath;
})();

const CodePathAnalyzer = (() => {
  function isCaseNode(node) {
    return Boolean(node.test);
  }

  function isPropertyDefinitionValue(node) {
    const parent = node.parent;

    return parent && parent.type === "PropertyDefinition" && parent.value === node;
  }

  function isHandledLogicalOperator(operator) {
    return operator === "&&" || operator === "||" || operator === "??";
  }

  function isLogicalAssignmentOperator(operator) {
    return operator === "&&=" || operator === "||=" || operator === "??=";
  }

  function getLabel(node) {
    if (node.parent.type === "LabeledStatement") {
      return node.parent.label.name;
    }
    return null;
  }

  function isForkingByTrueOrFalse(node) {
    const parent = node.parent;

    switch (parent.type) {
      case "ConditionalExpression":
      case "IfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
      case "ForStatement":
        return parent.test === node;

      case "LogicalExpression":
        return isHandledLogicalOperator(parent.operator);

      case "AssignmentExpression":
        return isLogicalAssignmentOperator(parent.operator);

      default:
        return false;
    }
  }

  function getBooleanValueIfSimpleConstant(node) {
    if (node.type === "Literal") {
      return Boolean(node.value);
    }
    return void 0;
  }

  function isIdentifierReference(node) {
    const parent = node.parent;

    switch (parent.type) {
      case "LabeledStatement":
      case "BreakStatement":
      case "ContinueStatement":
      case "ArrayPattern":
      case "RestElement":
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
      case "CatchClause":
        return false;

      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "ClassDeclaration":
      case "ClassExpression":
      case "VariableDeclarator":
        return parent.id !== node;

      case "Property":
      case "PropertyDefinition":
      case "MethodDefinition":
        return parent.key !== node || parent.computed || parent.shorthand;

      case "AssignmentPattern":
        return parent.key !== node;

      default:
        return true;
    }
  }

  function forwardCurrentToHead(analyzer, node) {
    const codePath = analyzer.codePath;
    const state = CodePath.getState(codePath);
    const currentSegments = state.currentSegments;
    const headSegments = state.headSegments;
    const end = Math.max(currentSegments.length, headSegments.length);
    let i, currentSegment, headSegment;

    for (i = 0; i < end; ++i) {
      currentSegment = currentSegments[i];
      headSegment = headSegments[i];

      if (currentSegment !== headSegment && currentSegment) {
        const eventName = currentSegment.reachable ? "onCodePathSegmentEnd" : "onUnreachableCodePathSegmentEnd";

        analyzer.emit(eventName, [currentSegment, node]);
      }
    }

    state.currentSegments = headSegments;

    for (i = 0; i < end; ++i) {
      currentSegment = currentSegments[i];
      headSegment = headSegments[i];

      if (currentSegment !== headSegment && headSegment) {
        const eventName = headSegment.reachable ? "onCodePathSegmentStart" : "onUnreachableCodePathSegmentStart";
        CodePathSegment.markUsed(headSegment);
        analyzer.emit(eventName, [headSegment, node]);
      }
    }
  }

  function leaveFromCurrentSegment(analyzer, node) {
    const state = CodePath.getState(analyzer.codePath);
    const currentSegments = state.currentSegments;

    for (let i = 0; i < currentSegments.length; ++i) {
      const currentSegment = currentSegments[i];
      const eventName = currentSegment.reachable ? "onCodePathSegmentEnd" : "onUnreachableCodePathSegmentEnd";

      analyzer.emit(eventName, [currentSegment, node]);
    }

    state.currentSegments = [];
  }

  function preprocess(analyzer, node) {
    const codePath = analyzer.codePath;
    const state = CodePath.getState(codePath);
    const parent = node.parent;

    switch (parent.type) {
      case "CallExpression":
        if (parent.optional === true && parent.arguments.length >= 1 && parent.arguments[0] === node) {
          state.makeOptionalRight();
        }
        break;
      case "MemberExpression":
        if (parent.optional === true && parent.property === node) {
          state.makeOptionalRight();
        }
        break;

      case "LogicalExpression":
        if (parent.right === node && isHandledLogicalOperator(parent.operator)) {
          state.makeLogicalRight();
        }
        break;

      case "AssignmentExpression":
        if (parent.right === node && isLogicalAssignmentOperator(parent.operator)) {
          state.makeLogicalRight();
        }
        break;

      case "ConditionalExpression":
      case "IfStatement":
        if (parent.consequent === node) {
          state.makeIfConsequent();
        } else if (parent.alternate === node) {
          state.makeIfAlternate();
        }
        break;

      case "SwitchCase":
        if (parent.consequent[0] === node) {
          state.makeSwitchCaseBody(false, !parent.test);
        }
        break;

      case "TryStatement":
        if (parent.handler === node) {
          state.makeCatchBlock();
        } else if (parent.finalizer === node) {
          state.makeFinallyBlock();
        }
        break;

      case "WhileStatement":
        if (parent.test === node) {
          state.makeWhileTest(getBooleanValueIfSimpleConstant(node));
        } else {
          assert(parent.body === node);
          state.makeWhileBody();
        }
        break;

      case "DoWhileStatement":
        if (parent.body === node) {
          state.makeDoWhileBody();
        } else {
          assert(parent.test === node);
          state.makeDoWhileTest(getBooleanValueIfSimpleConstant(node));
        }
        break;

      case "ForStatement":
        if (parent.test === node) {
          state.makeForTest(getBooleanValueIfSimpleConstant(node));
        } else if (parent.update === node) {
          state.makeForUpdate();
        } else if (parent.body === node) {
          state.makeForBody();
        }
        break;

      case "ForInStatement":
      case "ForOfStatement":
        if (parent.left === node) {
          state.makeForInOfLeft();
        } else if (parent.right === node) {
          state.makeForInOfRight();
        } else {
          assert(parent.body === node);
          state.makeForInOfBody();
        }
        break;

      case "AssignmentPattern":
        if (parent.right === node) {
          state.pushForkContext();
          state.forkBypassPath();
          state.forkPath();
        }
        break;

      default:
        break;
    }
  }

  function processCodePathToEnter(analyzer, node) {
    let codePath = analyzer.codePath;
    let state = codePath && CodePath.getState(codePath);
    const parent = node.parent;

    function startCodePath(origin) {
      if (codePath) {
        forwardCurrentToHead(analyzer, node);
      }

      codePath = analyzer.codePath = new CodePath({
        id: analyzer.idGenerator.next(),
        origin,
        upper: codePath,
        onLooped: analyzer.onLooped,
      });
      state = CodePath.getState(codePath);
      analyzer.emit("onCodePathStart", [codePath, node]);
    }

    if (isPropertyDefinitionValue(node)) {
      startCodePath("class-field-initializer");
    }

    switch (node.type) {
      case "Program":
        startCodePath("program");
        break;

      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        startCodePath("function");
        break;

      case "StaticBlock":
        startCodePath("class-static-block");
        break;

      case "ChainExpression":
        state.pushChainContext();
        break;
      case "CallExpression":
        if (node.optional === true) {
          state.makeOptionalNode();
        }
        break;
      case "MemberExpression":
        if (node.optional === true) {
          state.makeOptionalNode();
        }
        break;

      case "LogicalExpression":
        if (isHandledLogicalOperator(node.operator)) {
          state.pushChoiceContext(node.operator, isForkingByTrueOrFalse(node));
        }
        break;

      case "AssignmentExpression":
        if (isLogicalAssignmentOperator(node.operator)) {
          state.pushChoiceContext(node.operator.slice(0, -1), isForkingByTrueOrFalse(node));
        }
        break;

      case "ConditionalExpression":
      case "IfStatement":
        state.pushChoiceContext("test", false);
        break;

      case "SwitchStatement":
        state.pushSwitchContext(node.cases.some(isCaseNode), getLabel(node));
        break;

      case "TryStatement":
        state.pushTryContext(Boolean(node.finalizer));
        break;

      case "SwitchCase":
        if (parent.discriminant !== node && parent.cases[0] !== node) {
          state.forkPath();
        }
        break;

      case "WhileStatement":
      case "DoWhileStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
        state.pushLoopContext(node.type, getLabel(node));
        break;

      case "LabeledStatement":
        if (!breakableTypePattern.test(node.body.type)) {
          state.pushBreakContext(false, node.label.name);
        }
        break;

      default:
        break;
    }

    forwardCurrentToHead(analyzer, node);
  }

  function processCodePathToExit(analyzer, node) {
    const codePath = analyzer.codePath;
    const state = CodePath.getState(codePath);
    let dontForward = false;

    switch (node.type) {
      case "ChainExpression":
        state.popChainContext();
        break;

      case "IfStatement":
      case "ConditionalExpression":
        state.popChoiceContext();
        break;

      case "LogicalExpression":
        if (isHandledLogicalOperator(node.operator)) {
          state.popChoiceContext();
        }
        break;

      case "AssignmentExpression":
        if (isLogicalAssignmentOperator(node.operator)) {
          state.popChoiceContext();
        }
        break;

      case "SwitchStatement":
        state.popSwitchContext();
        break;

      case "SwitchCase":
        if (node.consequent.length === 0) {
          state.makeSwitchCaseBody(true, !node.test);
        }
        if (state.forkContext.reachable) {
          dontForward = true;
        }
        break;

      case "TryStatement":
        state.popTryContext();
        break;

      case "BreakStatement":
        forwardCurrentToHead(analyzer, node);
        state.makeBreak(node.label && node.label.name);
        dontForward = true;
        break;

      case "ContinueStatement":
        forwardCurrentToHead(analyzer, node);
        state.makeContinue(node.label && node.label.name);
        dontForward = true;
        break;

      case "ReturnStatement":
        forwardCurrentToHead(analyzer, node);
        state.makeReturn();
        dontForward = true;
        break;

      case "ThrowStatement":
        forwardCurrentToHead(analyzer, node);
        state.makeThrow();
        dontForward = true;
        break;

      case "Identifier":
        if (isIdentifierReference(node)) {
          state.makeFirstThrowablePathInTryOrCatchBlock();
          dontForward = true;
        }
        break;

      case "CallExpression":
      case "ImportExpression":
      case "MemberExpression":
      case "NewExpression":
        state.makeFirstThrowablePathInTryOrCatchBlock();
        break;

      case "YieldExpression":
        state.makeYield();
        break;

      case "WhileStatement":
      case "DoWhileStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
        state.popLoopContext();
        break;

      case "AssignmentPattern":
        state.popForkContext();
        break;

      case "LabeledStatement":
        if (!breakableTypePattern.test(node.body.type)) {
          state.popBreakContext();
        }
        break;

      default:
        break;
    }

    if (!dontForward) {
      forwardCurrentToHead(analyzer, node);
    }
  }

  function postprocess(analyzer, node) {
    function endCodePath() {
      let codePath = analyzer.codePath;

      CodePath.getState(codePath).makeFinal();

      leaveFromCurrentSegment(analyzer, node);
      analyzer.emit("onCodePathEnd", [codePath, node]);

      codePath = analyzer.codePath = analyzer.codePath.upper;
      if (codePath) {
      }
    }

    switch (node.type) {
      case "Program":
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "StaticBlock": {
        endCodePath();
        break;
      }

      case "CallExpression":
        if (node.optional === true && node.arguments.length === 0) {
          CodePath.getState(analyzer.codePath).makeOptionalRight();
        }
        break;

      default:
        break;
    }

    if (isPropertyDefinitionValue(node)) {
      endCodePath();
    }
  }

  class CodePathAnalyzer {
    constructor(eventGenerator) {
      this.original = eventGenerator;
      this.emit = eventGenerator.emit;
      this.codePath = null;
      this.idGenerator = new IdGenerator("s");
      this.currentNode = null;
      this.onLooped = this.onLooped.bind(this);
    }

    enterNode(node) {
      this.currentNode = node;

      if (node.parent) {
        preprocess(this, node);
      }

      processCodePathToEnter(this, node);

      this.original.enterNode(node);

      this.currentNode = null;
    }

    leaveNode(node) {
      this.currentNode = node;

      processCodePathToExit(this, node);

      this.original.leaveNode(node);

      postprocess(this, node);

      this.currentNode = null;
    }

    onLooped(fromSegment, toSegment) {
      if (fromSegment.reachable && toSegment.reachable) {
        this.emit("onCodePathSegmentLoop", [fromSegment, toSegment, this.currentNode]);
      }
    }
  }

  return CodePathAnalyzer;
})();
