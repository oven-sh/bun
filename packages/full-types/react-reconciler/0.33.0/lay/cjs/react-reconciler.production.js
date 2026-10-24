/**
 * @license React
 * react-reconciler.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use strict";
module.exports = function ($$$config: RR.HostConfig): RR.Reconciler {
  function createFiber(tag: RR.WorkTag, pendingProps: RR.Fiber["pendingProps"], key: string | null, mode: RR.TypeOfMode): RR.Fiber {
    return new FiberNode(tag, pendingProps, key, mode);
  }
  function noop(): void {}
  function formatProdErrorMessage(code: number, ...args: unknown[]): string; function formatProdErrorMessage(code: number): string {
    var url = "https://react.dev/errors/" + code;
    if (1 < arguments.length) {
      url += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var i = 2; i < arguments.length; i++)
        url += "&args[]=" + encodeURIComponent(arguments[i]);
    }
    return (
      "Minified React error #" +
      code +
      "; visit " +
      url +
      " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
    );
  }
  function getNearestMountedFiber(fiber: RR.Fiber | null): RR.Fiber | null {
    var node: RR.Fiber = (fiber as RR.Fiber),
      nearestMounted: RR.Fiber | null = fiber!;
    if (fiber!.alternate) for (; node.return; ) node = node.return;
    else {
      fiber = node;
      do
        (node = fiber),
          0 !== (node.flags & 4098) && (nearestMounted = node.return),
          (fiber = node.return);
      while (fiber);
    }
    return 3 === node.tag ? nearestMounted : null;
  }
  function assertIsMounted(fiber: RR.Fiber): void {
    if (getNearestMountedFiber(fiber) !== fiber)
      throw Error(formatProdErrorMessage(188));
  }
  function findCurrentFiberUsingSlowPath(fiber: RR.Fiber): RR.Fiber | null {
    var alternate: RR.Fiber | null = fiber.alternate;
    if (!alternate) {
      alternate = getNearestMountedFiber(fiber);
      if (null === alternate) throw Error(formatProdErrorMessage(188));
      return alternate !== fiber ? null : fiber;
    }
    for (var a: RR.Fiber = fiber, b: RR.Fiber | null = alternate; ; ) {
      var parentA: RR.Fiber | null = a.return;
      if (null === parentA) break;
      var parentB: RR.Fiber | null = parentA.alternate;
      if (null === parentB) {
        b = parentA.return;
        if (null !== b) {
          a = b;
          continue;
        }
        break;
      }
      if (parentA.child === parentB.child) {
        for (parentB = parentA.child; parentB; ) {
          if (parentB === a) return assertIsMounted(parentA), fiber;
          if (parentB === b) return assertIsMounted(parentA), alternate;
          parentB = parentB.sibling;
        }
        throw Error(formatProdErrorMessage(188));
      }
      if (a.return !== b.return) (a = parentA), (b = parentB);
      else {
        for (var didFindChild = !1, child$0: RR.Fiber | null = parentA.child; child$0; ) {
          if (child$0 === a) {
            didFindChild = !0;
            a = parentA;
            b = parentB;
            break;
          }
          if (child$0 === b) {
            didFindChild = !0;
            b = parentA;
            a = parentB;
            break;
          }
          child$0 = child$0.sibling;
        }
        if (!didFindChild) {
          for (child$0 = parentB.child; child$0; ) {
            if (child$0 === a) {
              didFindChild = !0;
              a = parentB;
              b = parentA;
              break;
            }
            if (child$0 === b) {
              didFindChild = !0;
              b = parentB;
              a = parentA;
              break;
            }
            child$0 = child$0.sibling;
          }
          if (!didFindChild) throw Error(formatProdErrorMessage(189));
        }
      }
      if (a.alternate !== b) throw Error(formatProdErrorMessage(190));
    }
    if (3 !== a.tag) throw Error(formatProdErrorMessage(188));
    return (a.stateNode as RR.FiberRoot).current === a ? fiber : alternate;
  }
  function findCurrentHostFiberImpl(node: RR.Fiber | null): RR.Fiber | null {
    var tag: RR.WorkTag | RR.Fiber | null = node!.tag;
    if (5 === tag || 26 === tag || 27 === tag || 6 === tag) return node!;
    for (node = node!.child; null !== node; ) {
      tag = findCurrentHostFiberImpl(node);
      if (null !== tag) return tag;
      node = node.sibling;
    }
    return null;
  }
  function findCurrentHostFiberWithNoPortalsImpl(node: RR.Fiber | null): RR.Fiber | null {
    var tag: RR.WorkTag | RR.Fiber | null = node!.tag;
    if (5 === tag || 26 === tag || 27 === tag || 6 === tag) return node!;
    for (node = node!.child; null !== node; ) {
      if (
        4 !== node.tag &&
        ((tag = findCurrentHostFiberWithNoPortalsImpl(node)), null !== tag)
      )
        return tag;
      node = node.sibling;
    }
    return null;
  }
  function getIteratorFn(maybeIterable: RR.ReactNode): RR.IteratorFn | null {
    if (null === maybeIterable || "object" !== typeof maybeIterable)
      return null;
    maybeIterable =
      (MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL]) ||
      maybeIterable["@@iterator"];
    return "function" === typeof maybeIterable ? maybeIterable : null;
  }
  function getComponentNameFromType(type: RR.AnyElementType): string | null {
    if (null == type) return null;
    if ("function" === typeof type)
      return type.$$typeof === REACT_CLIENT_REFERENCE
        ? null
        : type.displayName || type.name || null;
    if ("string" === typeof type) return type;
    switch (type) {
      case REACT_FRAGMENT_TYPE:
        return "Fragment";
      case REACT_PROFILER_TYPE:
        return "Profiler";
      case REACT_STRICT_MODE_TYPE:
        return "StrictMode";
      case REACT_SUSPENSE_TYPE:
        return "Suspense";
      case REACT_SUSPENSE_LIST_TYPE:
        return "SuspenseList";
      case REACT_ACTIVITY_TYPE:
        return "Activity";
    }
    if ("object" === typeof type)
      switch (type.$$typeof) {
        case REACT_PORTAL_TYPE:
          return "Portal";
        case REACT_CONTEXT_TYPE:
          return type.displayName || "Context";
        case REACT_CONSUMER_TYPE:
          return (type._context.displayName || "Context") + ".Consumer";
        case REACT_FORWARD_REF_TYPE:
          var innerType = type.render;
          type = type.displayName;
          type ||
            ((type = innerType.displayName || innerType.name || ""),
            (type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef"));
          return type;
        case REACT_MEMO_TYPE:
          return (
            (innerType = type.displayName || null),
            null !== innerType
              ? innerType
              : getComponentNameFromType(type.type) || "Memo"
          );
        case REACT_LAZY_TYPE:
          innerType = type._payload;
          type = type._init;
          try {
            return getComponentNameFromType(type(innerType));
          } catch (x) {}
      }
    return null;
  }
  function createCursor<T>(defaultValue: T): RR.StackCursor<T> {
    return { current: defaultValue };
  }
  function pop<T>(cursor: RR.StackCursor<T>): void {
    0 > index$jscomp$0 ||
      ((cursor.current = valueStack[index$jscomp$0]),
      (valueStack[index$jscomp$0] = null),
      index$jscomp$0--);
  }
  function push<T>(cursor: RR.StackCursor<T>, value: T): void {
    index$jscomp$0++;
    valueStack[index$jscomp$0] = cursor.current;
    cursor.current = value;
  }
  function clz32Fallback(x: number): number {
    x >>>= 0;
    return 0 === x ? 32 : (31 - ((log$1(x) / LN2) | 0)) | 0;
  }
  function getHighestPriorityLanes(lanes: RR.Lanes): RR.Lanes {
    var pendingSyncLanes: RR.Lanes = lanes & 42;
    if (0 !== pendingSyncLanes) return pendingSyncLanes;
    switch (lanes & -lanes) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
        return 64;
      case 128:
        return 128;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
        return lanes & 261888;
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return lanes & 3932160;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return lanes & 62914560;
      case 67108864:
        return 67108864;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 0;
      default:
        return lanes;
    }
  }
  function getNextLanes(root: RR.FiberRoot | RR.Lanes, wipLanes: RR.Lanes, rootHasPendingCommit: boolean | RR.Lanes | RR.Lane): RR.Lanes {
    var pendingLanes: RR.Lanes = (root as RR.FiberRoot).pendingLanes;
    if (0 === pendingLanes) return 0;
    var nextLanes: RR.Lanes = 0,
      suspendedLanes: RR.Lanes = (root as RR.FiberRoot).suspendedLanes,
      pingedLanes: RR.Lanes = (root as RR.FiberRoot).pingedLanes;
    root = (root as RR.FiberRoot).warmLanes;
    var nonIdlePendingLanes: RR.Lanes = pendingLanes & 134217727;
    0 !== nonIdlePendingLanes
      ? ((pendingLanes = nonIdlePendingLanes & ~suspendedLanes),
        0 !== pendingLanes
          ? (nextLanes = getHighestPriorityLanes(pendingLanes))
          : ((pingedLanes &= nonIdlePendingLanes),
            0 !== pingedLanes
              ? (nextLanes = getHighestPriorityLanes(pingedLanes))
              : (rootHasPendingCommit as boolean) ||
                ((rootHasPendingCommit = nonIdlePendingLanes & ~root),
                0 !== rootHasPendingCommit &&
                  (nextLanes = getHighestPriorityLanes(rootHasPendingCommit)))))
      : ((nonIdlePendingLanes = pendingLanes & ~suspendedLanes),
        0 !== nonIdlePendingLanes
          ? (nextLanes = getHighestPriorityLanes(nonIdlePendingLanes))
          : 0 !== pingedLanes
            ? (nextLanes = getHighestPriorityLanes(pingedLanes))
            : (rootHasPendingCommit as boolean) ||
              ((rootHasPendingCommit = pendingLanes & ~root),
              0 !== rootHasPendingCommit &&
                (nextLanes = getHighestPriorityLanes(rootHasPendingCommit))));
    return 0 === nextLanes
      ? 0
      : 0 !== wipLanes &&
          wipLanes !== nextLanes &&
          0 === (wipLanes & suspendedLanes) &&
          ((suspendedLanes = nextLanes & -nextLanes),
          (rootHasPendingCommit = wipLanes & -wipLanes),
          suspendedLanes >= rootHasPendingCommit ||
            (32 === suspendedLanes && 0 !== (rootHasPendingCommit & 4194048)))
        ? wipLanes
        : nextLanes;
  }
  function checkIfRootIsPrerendering(root: RR.FiberRoot, renderLanes: RR.Lanes): boolean {
    return (
      0 ===
      (root.pendingLanes &
        ~(root.suspendedLanes & ~root.pingedLanes) &
        renderLanes)
    );
  }
  function computeExpirationTime(lane: RR.Lane, currentTime: RR.Milliseconds): RR.Milliseconds {
    switch (lane) {
      case 1:
      case 2:
      case 4:
      case 8:
      case 64:
        return currentTime + 250;
      case 16:
      case 32:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return currentTime + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return -1;
      case 67108864:
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function claimNextRetryLane(): RR.Lane {
    var lane: RR.Lane = nextRetryLane;
    nextRetryLane <<= 1;
    0 === (nextRetryLane & 62914560) && (nextRetryLane = 4194304);
    return lane;
  }
  function createLaneMap<T>(initial: T): RR.LaneMap<T> {
    for (var laneMap: RR.LaneMap<T> = [], i = 0; 31 > i; i++) laneMap.push(initial);
    return laneMap;
  }
  function markRootUpdated$1(root: RR.FiberRoot, updateLane: RR.Lane): void {
    root.pendingLanes |= updateLane;
    268435456 !== updateLane &&
      ((root.suspendedLanes = 0), (root.pingedLanes = 0), (root.warmLanes = 0));
  }
  function markRootFinished(
    root: RR.FiberRoot,
    finishedLanes: RR.Lanes,
    remainingLanes: RR.Lanes,
    spawnedLane: RR.Lane,
    updatedLanes: RR.Lanes,
    suspendedRetryLanes: RR.Lanes
  ): void {
    var previouslyPendingLanes: RR.Lanes = root.pendingLanes;
    root.pendingLanes = remainingLanes;
    root.suspendedLanes = 0;
    root.pingedLanes = 0;
    root.warmLanes = 0;
    root.expiredLanes &= remainingLanes;
    root.entangledLanes &= remainingLanes;
    root.errorRecoveryDisabledLanes &= remainingLanes;
    root.shellSuspendCounter = 0;
    var entanglements = root.entanglements,
      expirationTimes = root.expirationTimes,
      hiddenUpdates = root.hiddenUpdates;
    for (
      remainingLanes = previouslyPendingLanes & ~remainingLanes;
      0 < remainingLanes;

    ) {
      var index$5 = 31 - clz32(remainingLanes),
        lane = 1 << index$5;
      entanglements[index$5] = 0;
      expirationTimes[index$5] = -1;
      var hiddenUpdatesForLane = hiddenUpdates[index$5]!;
      if (null !== hiddenUpdatesForLane)
        for (
          hiddenUpdates[index$5] = null, index$5 = 0;
          index$5 < hiddenUpdatesForLane.length;
          index$5++
        ) {
          var update = hiddenUpdatesForLane[index$5]!;
          null !== update && (update.lane &= -536870913);
        }
      remainingLanes &= ~lane;
    }
    0 !== spawnedLane && markSpawnedDeferredLane(root, spawnedLane, 0);
    0 !== suspendedRetryLanes &&
      0 === updatedLanes &&
      0 !== root.tag &&
      (root.suspendedLanes |=
        suspendedRetryLanes & ~(previouslyPendingLanes & ~finishedLanes));
  }
  function markSpawnedDeferredLane(root: RR.FiberRoot, spawnedLane: RR.Lane, entangledLanes: RR.Lanes): void {
    root.pendingLanes |= spawnedLane;
    root.suspendedLanes &= ~spawnedLane;
    var spawnedLaneIndex = 31 - clz32(spawnedLane);
    root.entangledLanes |= spawnedLane;
    root.entanglements[spawnedLaneIndex] =
      root.entanglements[spawnedLaneIndex]! |
      1073741824 |
      (entangledLanes & 261930);
  }
  function markRootEntangled(root: RR.FiberRoot | RR.FiberRoot["entanglements"], entangledLanes: RR.Lanes): void {
    var rootEntangledLanes: RR.Lanes = ((root as RR.FiberRoot).entangledLanes |= entangledLanes);
    for (root = (root as RR.FiberRoot).entanglements; rootEntangledLanes; ) {
      var index$6 = 31 - clz32(rootEntangledLanes),
        lane = 1 << index$6;
      (lane & entangledLanes) | ((root as RR.FiberRoot["entanglements"])[index$6]! & entangledLanes) &&
        ((root as RR.FiberRoot["entanglements"])[index$6]! |= entangledLanes);
      rootEntangledLanes &= ~lane;
    }
  }
  function getBumpedLaneForHydration(root: RR.FiberRoot, renderLanes: RR.Lanes): RR.Lane {
    var renderLane: RR.Lane = renderLanes & -renderLanes;
    renderLane =
      0 !== (renderLane & 42) ? 1 : getBumpedLaneForHydrationByLane(renderLane);
    return 0 !== (renderLane & (root.suspendedLanes | renderLanes))
      ? 0
      : renderLane;
  }
  function getBumpedLaneForHydrationByLane(lane: RR.Lane): RR.Lane {
    switch (lane) {
      case 2:
        lane = 1;
        break;
      case 8:
        lane = 4;
        break;
      case 32:
        lane = 16;
        break;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        lane = 128;
        break;
      case 268435456:
        lane = 134217728;
        break;
      default:
        lane = 0;
    }
    return lane;
  }
  function lanesToEventPriority(lanes: RR.Lanes): RR.EventPriority {
    lanes &= -lanes;
    return 2 < lanes
      ? 8 < lanes
        ? 0 !== (lanes & 134217727)
          ? 32
          : 268435456
        : 8
      : 2;
  }
  function setIsStrictModeForDevtools(newIsStrictMode: boolean): void {
    "function" === typeof log && unstable_setDisableYieldValue!(newIsStrictMode);
    if (injectedHook && "function" === typeof injectedHook.setStrictMode)
      try {
        injectedHook.setStrictMode(rendererID, newIsStrictMode);
      } catch (err) {}
  }
  function is(x: unknown, y: any): boolean {
    return (x === y && (0 !== x || 1 / x === 1 / y)) || (x !== x && y !== y);
  }
  function describeBuiltInComponentFrame(name: string): string {
    if (void 0 === prefix)
      try {
        throw Error();
      } catch (x: RR.Thrown) {
        var match: RegExpMatchArray | null = x.stack.trim().match(/\n( *(at )?)/);
        prefix = (match && match[1]) || "";
        suffix =
          -1 < x.stack.indexOf("\n    at")
            ? " (<anonymous>)"
            : -1 < x.stack.indexOf("@")
              ? "@unknown:0:0"
              : "";
      }
    return "\n" + prefix + name + suffix;
  }
  function describeNativeComponentFrame(fn: RR.ComponentFunction, construct: boolean): string {
    if (!fn || reentry) return "";
    reentry = !0;
    var previousPrepareStackTrace: RR.PrepareStackTrace | string | null | undefined = (Error as any).prepareStackTrace;
    (Error as any).prepareStackTrace = void 0;
    try {
      var RunInRootFrame: RR.RootFrameRunner | number = {
        DetermineComponentFrameRoot: function () {
          try {
            if (construct) {
              var Fake: RR.FakeOrResult = function () {
                throw Error();
              };
              Object.defineProperty(Fake.prototype, "props", {
                set: function () {
                  throw Error();
                }
              });
              if ("object" === typeof Reflect && Reflect.construct) {
                try {
                  Reflect.construct(Fake, []);
                } catch (x: RR.Thrown) {
                  var control: Error | undefined = x;
                }
                Reflect.construct(fn, [], Fake);
              } else {
                try {
                  Fake.call();
                } catch (x$8: RR.Thrown) {
                  control = x$8;
                }
                fn.call(Fake.prototype);
              }
            } else {
              try {
                throw Error();
              } catch (x$9: RR.Thrown) {
                control = x$9;
              }
              (Fake = fn()) &&
                "function" === typeof Fake.catch &&
                Fake.catch(function () {});
            }
          } catch (sample: RR.Thrown) {
            if (sample && control && "string" === typeof sample.stack)
              return [sample.stack, control.stack];
          }
          return [null, null];
        }
      };
      RunInRootFrame.DetermineComponentFrameRoot.displayName =
        "DetermineComponentFrameRoot";
      var namePropDescriptor: PropertyDescriptor | number | undefined = Object.getOwnPropertyDescriptor(
        RunInRootFrame.DetermineComponentFrameRoot,
        "name"
      );
      namePropDescriptor &&
        namePropDescriptor.configurable &&
        Object.defineProperty(
          RunInRootFrame.DetermineComponentFrameRoot,
          "name",
          { value: "DetermineComponentFrameRoot" }
        );
      var _RunInRootFrame$Deter = RunInRootFrame.DetermineComponentFrameRoot(),
        sampleStack = _RunInRootFrame$Deter[0],
        controlStack = _RunInRootFrame$Deter[1];
      if (sampleStack && controlStack) {
        var sampleLines = sampleStack.split("\n"),
          controlLines = controlStack.split("\n");
        for (
          namePropDescriptor = RunInRootFrame = 0;
          RunInRootFrame < sampleLines.length &&
          !sampleLines[RunInRootFrame]!.includes("DetermineComponentFrameRoot");

        )
          RunInRootFrame++;
        for (
          ;
          namePropDescriptor < controlLines.length &&
          !controlLines[namePropDescriptor]!.includes(
            "DetermineComponentFrameRoot"
          );

        )
          namePropDescriptor++;
        if (
          RunInRootFrame === sampleLines.length ||
          namePropDescriptor === controlLines.length
        )
          for (
            RunInRootFrame = sampleLines.length - 1,
              namePropDescriptor = controlLines.length - 1;
            1 <= RunInRootFrame &&
            0 <= namePropDescriptor &&
            sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor];

          )
            namePropDescriptor--;
        for (
          ;
          1 <= RunInRootFrame && 0 <= namePropDescriptor;
          RunInRootFrame--, namePropDescriptor--
        )
          if (
            sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor]
          ) {
            if (1 !== RunInRootFrame || 1 !== namePropDescriptor) {
              do
                if (
                  (RunInRootFrame--,
                  namePropDescriptor--,
                  0 > namePropDescriptor ||
                    sampleLines[RunInRootFrame] !==
                      controlLines[namePropDescriptor])
                ) {
                  var frame =
                    "\n" +
                    sampleLines[RunInRootFrame]!.replace(" at new ", " at ");
                  fn.displayName &&
                    frame.includes("<anonymous>") &&
                    (frame = frame.replace("<anonymous>", fn.displayName));
                  return frame;
                }
              while (1 <= RunInRootFrame && 0 <= namePropDescriptor);
            }
            break;
          }
      }
    } finally {
      (reentry = !1), ((Error as any).prepareStackTrace = previousPrepareStackTrace);
    }
    return (previousPrepareStackTrace = fn ? fn.displayName || fn.name : "")
      ? describeBuiltInComponentFrame(previousPrepareStackTrace as string)
      : "";
  }
  function describeFiber(fiber: RR.Fiber, childFiber: RR.Fiber | null): string {
    switch (fiber.tag) {
      case 26:
      case 27:
      case 5:
        return describeBuiltInComponentFrame(fiber.type as string);
      case 16:
        return describeBuiltInComponentFrame("Lazy");
      case 13:
        return fiber.child !== childFiber && null !== childFiber
          ? describeBuiltInComponentFrame("Suspense Fallback")
          : describeBuiltInComponentFrame("Suspense");
      case 19:
        return describeBuiltInComponentFrame("SuspenseList");
      case 0:
      case 15:
        return describeNativeComponentFrame(fiber.type as RR.FunctionComponent, !1);
      case 11:
        return describeNativeComponentFrame((fiber.type as RR.ForwardRefType).render, !1);
      case 1:
        return describeNativeComponentFrame(fiber.type as RR.ClassComponent, !0);
      case 31:
        return describeBuiltInComponentFrame("Activity");
      default:
        return "";
    }
  }
  function getStackByFiberInDevAndProd(workInProgress: RR.Fiber | null): string {
    try {
      var info = "",
        previous: RR.Fiber | null = null;
      do
        (info += describeFiber((workInProgress as RR.Fiber), previous)),
          (previous = workInProgress!),
          (workInProgress = workInProgress!.return);
      while (workInProgress);
      return info;
    } catch (x: RR.Thrown) {
      return "\nError generating stack: " + x.message + "\n" + x.stack;
    }
  }
  function createCapturedValueAtFiber(value: RR.Thrown, source: RR.Fiber | RR.CapturedValue): RR.CapturedValue {
    if ("object" === typeof value && null !== value) {
      var existing = CapturedStacks.get(value);
      if (void 0 !== existing) return existing;
      source = {
        value: value,
        source: (source as RR.Fiber),
        stack: getStackByFiberInDevAndProd((source as RR.Fiber))
      } as RR.CapturedValue;
      CapturedStacks.set(value, source);
      return source;
    }
    return {
      value: value,
      source: (source as RR.Fiber),
      stack: getStackByFiberInDevAndProd((source as RR.Fiber))
    };
  }
  function pushTreeFork(workInProgress: RR.Fiber, totalChildren: number): void {
    forkStack[forkStackIndex++] = treeForkCount;
    forkStack[forkStackIndex++] = treeForkProvider;
    treeForkProvider = workInProgress;
    treeForkCount = totalChildren;
  }
  function pushTreeId(workInProgress: RR.Fiber | string, totalChildren: number, index: number): void {
    idStack[idStackIndex++] = treeContextId;
    idStack[idStackIndex++] = treeContextOverflow;
    idStack[idStackIndex++] = treeContextProvider;
    treeContextProvider = (workInProgress as RR.Fiber);
    var baseIdWithLeadingBit = treeContextId;
    workInProgress = treeContextOverflow;
    var baseLength = 32 - clz32(baseIdWithLeadingBit) - 1;
    baseIdWithLeadingBit &= ~(1 << baseLength);
    index += 1;
    var length: number | string = 32 - clz32(totalChildren) + baseLength;
    if (30 < length) {
      var numberOfOverflowBits = baseLength - (baseLength % 5);
      length = (
        baseIdWithLeadingBit &
        ((1 << numberOfOverflowBits) - 1)
      ).toString(32);
      baseIdWithLeadingBit >>= numberOfOverflowBits;
      baseLength -= numberOfOverflowBits;
      treeContextId =
        (1 << (32 - clz32(totalChildren) + baseLength)) |
        (index << baseLength) |
        baseIdWithLeadingBit;
      treeContextOverflow = length + workInProgress;
    } else
      (treeContextId =
        (1 << length) | (index << baseLength) | baseIdWithLeadingBit),
        (treeContextOverflow = workInProgress);
  }
  function pushMaterializedTreeId(workInProgress: RR.Fiber): void {
    null !== workInProgress.return &&
      (pushTreeFork(workInProgress, 1), pushTreeId(workInProgress, 1, 0));
  }
  function popTreeContext(workInProgress: RR.Fiber): void {
    for (; workInProgress === treeForkProvider; )
      (treeForkProvider = forkStack[--forkStackIndex] as RR.Fiber | null),
        (forkStack[forkStackIndex] = null),
        (treeForkCount = forkStack[--forkStackIndex] as number),
        (forkStack[forkStackIndex] = null);
    for (; workInProgress === treeContextProvider; )
      (treeContextProvider = idStack[--idStackIndex] as RR.Fiber | null),
        (idStack[idStackIndex] = null),
        (treeContextOverflow = idStack[--idStackIndex] as string),
        (idStack[idStackIndex] = null),
        (treeContextId = idStack[--idStackIndex] as number),
        (idStack[idStackIndex] = null);
  }
  function restoreSuspendedTreeContext(workInProgress: RR.Fiber, suspendedContext: RR.TreeContext): void {
    idStack[idStackIndex++] = treeContextId;
    idStack[idStackIndex++] = treeContextOverflow;
    idStack[idStackIndex++] = treeContextProvider;
    treeContextId = suspendedContext.id;
    treeContextOverflow = suspendedContext.overflow;
    treeContextProvider = workInProgress;
  }
  function pushHostContainer(fiber: RR.Fiber | RR.HostContext, nextRootInstance: RR.Container): void {
    push(rootInstanceStackCursor, nextRootInstance);
    push(contextFiberStackCursor, (fiber as RR.Fiber));
    push(contextStackCursor, null);
    fiber = getRootHostContext(nextRootInstance);
    pop(contextStackCursor);
    push(contextStackCursor, fiber);
  }
  function popHostContainer(): void {
    pop(contextStackCursor);
    pop(contextFiberStackCursor);
    pop(rootInstanceStackCursor);
  }
  function pushHostContext(fiber: RR.Fiber): void {
    null !== fiber.memoizedState && push(hostTransitionProviderCursor, fiber);
    var context = contextStackCursor.current,
      nextContext = getChildHostContext(context, fiber.type);
    context !== nextContext &&
      (push(contextFiberStackCursor, fiber),
      push(contextStackCursor, nextContext));
  }
  function popHostContext(fiber: RR.Fiber): void {
    contextFiberStackCursor.current === fiber &&
      (pop(contextStackCursor), pop(contextFiberStackCursor));
    hostTransitionProviderCursor.current === fiber &&
      (pop(hostTransitionProviderCursor),
      isPrimaryRenderer
        ? (HostTransitionContext._currentValue = NotPendingTransition)
        : (HostTransitionContext._currentValue2 = NotPendingTransition));
  }
  function throwOnHydrationMismatch(fiber: RR.Fiber, fromText?: boolean): never; function throwOnHydrationMismatch(fiber: RR.Fiber): never {
    var error = Error(
      formatProdErrorMessage(
        418,
        1 < arguments.length && void 0 !== arguments[1] && arguments[1]
          ? "text"
          : "HTML",
        ""
      )
    );
    queueHydrationError(createCapturedValueAtFiber(error, fiber));
    throw HydrationMismatchException;
  }
  function prepareToHydrateHostInstance(fiber: RR.Fiber, hostContext: RR.HostContext): void {
    if (!supportsHydration) throw Error(formatProdErrorMessage(175));
    hydrateInstance!(
      fiber.stateNode,
      fiber.type,
      fiber.memoizedProps,
      hostContext,
      fiber
    ) || throwOnHydrationMismatch(fiber, !0);
  }
  function popToNextHostParent(fiber: RR.Fiber): void {
    for (hydrationParentFiber = fiber.return; hydrationParentFiber; )
      switch (hydrationParentFiber.tag) {
        case 5:
        case 31:
        case 13:
          rootOrSingletonContext = !1;
          return;
        case 27:
        case 3:
          rootOrSingletonContext = !0;
          return;
        default:
          hydrationParentFiber = hydrationParentFiber.return;
      }
  }
  function popHydrationState(fiber: RR.Fiber | RR.SuspenseState | RR.SuspenseInstance | RR.ActivityState | RR.ActivityInstance | null): boolean {
    if (!supportsHydration || (fiber as RR.Fiber) !== hydrationParentFiber) return !1;
    if (!isHydrating) return popToNextHostParent((fiber as RR.Fiber)), (isHydrating = !0), !1;
    var tag = (fiber as RR.Fiber).tag;
    supportsSingletons
      ? 3 !== tag &&
        27 !== tag &&
        (5 !== tag ||
          (shouldDeleteUnhydratedTailInstances!((fiber as RR.Fiber).type) &&
            !shouldSetTextContent((fiber as RR.Fiber).type, (fiber as RR.Fiber).memoizedProps))) &&
        nextHydratableInstance &&
        throwOnHydrationMismatch((fiber as RR.Fiber))
      : 3 !== tag &&
        (5 !== tag ||
          (shouldDeleteUnhydratedTailInstances!((fiber as RR.Fiber).type) &&
            !shouldSetTextContent((fiber as RR.Fiber).type, (fiber as RR.Fiber).memoizedProps))) &&
        nextHydratableInstance &&
        throwOnHydrationMismatch((fiber as RR.Fiber));
    popToNextHostParent((fiber as RR.Fiber));
    if (13 === tag) {
      if (!supportsHydration) throw Error(formatProdErrorMessage(316));
      fiber = (fiber as RR.Fiber).memoizedState as RR.SuspenseState | null;
      fiber = null !== fiber ? fiber.dehydrated : null;
      if (!fiber) throw Error(formatProdErrorMessage(317));
      nextHydratableInstance =
        getNextHydratableInstanceAfterSuspenseInstance!(fiber);
    } else if (31 === tag) {
      fiber = (fiber as RR.Fiber).memoizedState as RR.ActivityState | null;
      fiber = null !== fiber ? fiber.dehydrated : null;
      if (!fiber) throw Error(formatProdErrorMessage(317));
      nextHydratableInstance =
        getNextHydratableInstanceAfterActivityInstance!(fiber);
    } else
      nextHydratableInstance =
        supportsSingletons && 27 === tag
          ? getNextHydratableSiblingAfterSingleton!(
              (fiber as RR.Fiber).type,
              nextHydratableInstance
            )
          : hydrationParentFiber
            ? getNextHydratableSibling!((fiber as RR.Fiber).stateNode)
            : null;
    return !0;
  }
  function resetHydrationState(): void {
    supportsHydration &&
      ((nextHydratableInstance = hydrationParentFiber = null),
      (isHydrating = !1));
  }
  function upgradeHydrationErrorsToRecoverable(): RR.CapturedValue[] | null {
    var queuedErrors = hydrationErrors;
    null !== queuedErrors &&
      (null === workInProgressRootRecoverableErrors
        ? (workInProgressRootRecoverableErrors = queuedErrors)
        : workInProgressRootRecoverableErrors.push.apply(
            workInProgressRootRecoverableErrors,
            queuedErrors
          ),
      (hydrationErrors = null));
    return queuedErrors;
  }
  function queueHydrationError(error: RR.CapturedValue): void {
    null === hydrationErrors
      ? (hydrationErrors = [error])
      : hydrationErrors.push(error);
  }
  function pushProvider<T>(providerFiber: RR.Fiber, context: RR.ReactContext<T>, nextValue: T): void {
    isPrimaryRenderer
      ? (push(valueCursor, context._currentValue),
        (context._currentValue = nextValue))
      : (push(valueCursor, context._currentValue2),
        (context._currentValue2 = nextValue));
  }
  function popProvider(context: RR.ReactContext): void {
    var currentValue = valueCursor.current;
    isPrimaryRenderer
      ? (context._currentValue = currentValue)
      : (context._currentValue2 = currentValue);
    pop(valueCursor);
  }
  function scheduleContextWorkOnParentPath(
    parent: RR.Fiber | null,
    renderLanes: RR.Lanes,
    propagationRoot: RR.Fiber
  ): void {
    for (; null !== parent; ) {
      var alternate = parent.alternate;
      (parent.childLanes & renderLanes) !== renderLanes
        ? ((parent.childLanes |= renderLanes),
          null !== alternate && (alternate.childLanes |= renderLanes))
        : null !== alternate &&
          (alternate.childLanes & renderLanes) !== renderLanes &&
          (alternate.childLanes |= renderLanes);
      if (parent === propagationRoot) break;
      parent = parent.return;
    }
  }
  function propagateContextChanges(
    workInProgress: RR.Fiber,
    contexts: RR.ReactContext[],
    renderLanes: RR.Lanes,
    forcePropagateEntireTree: boolean
  ): void {
    var fiber = workInProgress.child;
    null !== fiber && (fiber.return = workInProgress);
    for (; null !== fiber; ) {
      var list: RR.Dependencies | RR.ContextDependency | RR.Fiber | null = fiber.dependencies;
      if (null !== list) {
        var nextFiber = fiber.child;
        list = list.firstContext;
        a: for (; null !== list; ) {
          var dependency: RR.ContextDependency | RR.Fiber | null = list;
          list = fiber;
          for (var i = 0; i < contexts.length; i++)
            if (dependency.context === contexts[i]) {
              list.lanes |= renderLanes;
              dependency = list.alternate;
              null !== dependency && (dependency.lanes |= renderLanes);
              scheduleContextWorkOnParentPath(
                list.return,
                renderLanes,
                workInProgress
              );
              forcePropagateEntireTree || (nextFiber = null);
              break a;
            }
          list = dependency.next;
        }
      } else if (18 === fiber.tag) {
        nextFiber = fiber.return;
        if (null === nextFiber) throw Error(formatProdErrorMessage(341));
        nextFiber.lanes |= renderLanes;
        list = nextFiber.alternate;
        null !== list && (list.lanes |= renderLanes);
        scheduleContextWorkOnParentPath(nextFiber, renderLanes, workInProgress);
        nextFiber = null;
      } else nextFiber = fiber.child;
      if (null !== nextFiber) nextFiber.return = fiber;
      else
        for (nextFiber = fiber; null !== nextFiber; ) {
          if (nextFiber === workInProgress) {
            nextFiber = null;
            break;
          }
          fiber = nextFiber.sibling;
          if (null !== fiber) {
            fiber.return = nextFiber.return;
            nextFiber = fiber;
            break;
          }
          nextFiber = nextFiber.return;
        }
      fiber = nextFiber;
    }
  }
  function propagateParentContextChanges(
    current: RR.Fiber | RR.ReactContext[] | null,
    workInProgress: RR.Fiber,
    renderLanes: RR.Lanes,
    forcePropagateEntireTree: boolean
  ): void {
    current = null;
    for (
      var parent: RR.Fiber | null = workInProgress, isInsidePropagationBailout = !1;
      null !== parent;

    ) {
      if (!isInsidePropagationBailout)
        if (0 !== (parent.flags & 524288)) isInsidePropagationBailout = !0;
        else if (0 !== (parent.flags & 262144)) break;
      if (10 === parent.tag) {
        var currentParent: RR.Fiber | RR.ProviderProps | null = parent.alternate;
        if (null === currentParent) throw Error(formatProdErrorMessage(387));
        currentParent = currentParent.memoizedProps as RR.ProviderProps | null;
        if (null !== currentParent) {
          var context: RR.ReactContext = parent.type as RR.ReactContext;
          objectIs(parent.pendingProps.value, currentParent.value) ||
            (null !== current ? current.push(context) : (current = [context]));
        }
      } else if (parent === hostTransitionProviderCursor.current) {
        currentParent = parent.alternate;
        if (null === currentParent) throw Error(formatProdErrorMessage(387));
        (currentParent.memoizedState as RR.Hook).memoizedState !==
          (parent.memoizedState as RR.Hook).memoizedState &&
          (null !== current
            ? current.push(HostTransitionContext)
            : (current = [HostTransitionContext]));
      }
      parent = parent.return;
    }
    null !== current &&
      propagateContextChanges(
        workInProgress,
        current,
        renderLanes,
        forcePropagateEntireTree
      );
    workInProgress.flags |= 262144;
  }
  function checkIfContextChanged(currentDependencies: RR.Dependencies | RR.ContextDependency | null): boolean {
    for (
      currentDependencies = (currentDependencies as RR.Dependencies).firstContext;
      null !== currentDependencies;

    ) {
      var context = (currentDependencies as RR.ContextDependency | null)!.context;
      if (
        !objectIs(
          isPrimaryRenderer ? context._currentValue : context._currentValue2,
          (currentDependencies as RR.ContextDependency | null)!.memoizedValue
        )
      )
        return !0;
      currentDependencies = (currentDependencies as RR.ContextDependency | null)!.next;
    }
    return !1;
  }
  function prepareToReadContext(workInProgress: RR.Fiber | RR.Dependencies | null): void {
    currentlyRenderingFiber$1 = (workInProgress as RR.Fiber);
    lastContextDependency = null;
    workInProgress = (workInProgress as RR.Fiber).dependencies;
    null !== workInProgress && ((workInProgress as RR.Dependencies | null)!.firstContext = null);
  }
  function readContext<T>(context: RR.ReactContext<T>): T {
    return readContextForConsumer(currentlyRenderingFiber$1, context);
  }
  function readContextDuringReconciliation<T>(consumer: RR.Fiber, context: RR.ReactContext<T>): T {
    null === currentlyRenderingFiber$1 && prepareToReadContext(consumer);
    return readContextForConsumer(consumer, context);
  }
  function readContextForConsumer<T>(consumer: RR.Fiber | null, context: RR.ReactContext<T> | RR.ContextDependency): T {
    var value = isPrimaryRenderer
      ? (context as RR.ReactContext<T>)._currentValue
      : (context as RR.ReactContext<T>)._currentValue2;
    context = { context: (context as RR.ReactContext<T>), memoizedValue: value, next: null } as RR.ContextDependency;
    if (null === lastContextDependency) {
      if (null === consumer) throw Error(formatProdErrorMessage(308));
      lastContextDependency = context;
      consumer.dependencies = { lanes: 0, firstContext: context };
      consumer.flags |= 524288;
    } else lastContextDependency = lastContextDependency.next = context;
    return value;
  }
  function createCache(): RR.Cache {
    return {
      controller: new AbortControllerLocal(),
      data: new Map(),
      refCount: 0
    };
  }
  function releaseCache(cache: RR.Cache): void {
    cache.refCount--;
    0 === cache.refCount &&
      scheduleCallback$2(NormalPriority, function () {
        cache.controller.abort();
      });
  }
  function noop$1(): void {}
  function ensureRootIsScheduled(root: RR.FiberRoot): void {
    root !== lastScheduledRoot &&
      null === root.next &&
      (null === lastScheduledRoot
        ? (firstScheduledRoot = lastScheduledRoot = root)
        : (lastScheduledRoot = lastScheduledRoot.next = root));
    mightHavePendingSyncWork = !0;
    didScheduleMicrotask ||
      ((didScheduleMicrotask = !0), scheduleImmediateRootScheduleTask());
  }
  function flushSyncWorkAcrossRoots_impl(syncTransitionLanes: RR.Lanes, onlyLegacy: boolean): void {
    if (!isFlushingWork && mightHavePendingSyncWork) {
      isFlushingWork = !0;
      do {
        var didPerformSomeWork = !1;
        for (var root: RR.FiberRoot | null = firstScheduledRoot; null !== root; ) {
          if (!onlyLegacy)
            if (0 !== syncTransitionLanes) {
              var pendingLanes = root.pendingLanes;
              if (0 === pendingLanes) var JSCompiler_inline_result: RR.Lanes = 0;
              else {
                var suspendedLanes = root.suspendedLanes,
                  pingedLanes = root.pingedLanes;
                JSCompiler_inline_result =
                  ((1 << (31 - clz32(42 | syncTransitionLanes) + 1)) - 1) as RR.Lanes;
                JSCompiler_inline_result &=
                  pendingLanes & ~(suspendedLanes & ~pingedLanes);
                JSCompiler_inline_result =
                  JSCompiler_inline_result & 201326741
                    ? (JSCompiler_inline_result & 201326741) | 1
                    : JSCompiler_inline_result
                      ? JSCompiler_inline_result | 2
                      : 0;
              }
              0 !== JSCompiler_inline_result &&
                ((didPerformSomeWork = !0),
                performSyncWorkOnRoot(root, JSCompiler_inline_result));
            } else
              (JSCompiler_inline_result = workInProgressRootRenderLanes),
                (JSCompiler_inline_result = getNextLanes(
                  root,
                  root === workInProgressRoot ? JSCompiler_inline_result : 0,
                  null !== root.cancelPendingCommit ||
                    root.timeoutHandle !== noTimeout
                )),
                0 === (JSCompiler_inline_result & 3) ||
                  checkIfRootIsPrerendering(root, JSCompiler_inline_result) ||
                  ((didPerformSomeWork = !0),
                  performSyncWorkOnRoot(root, JSCompiler_inline_result));
          root = root.next;
        }
      } while (didPerformSomeWork);
      isFlushingWork = !1;
    }
  }
  function processRootScheduleInImmediateTask(): void {
    processRootScheduleInMicrotask();
  }
  function processRootScheduleInMicrotask(): void {
    mightHavePendingSyncWork = didScheduleMicrotask = !1;
    var syncTransitionLanes: RR.Lanes = 0;
    0 !== currentEventTransitionLane &&
      shouldAttemptEagerTransition() &&
      (syncTransitionLanes = currentEventTransitionLane);
    for (
      var currentTime = now(), prev: RR.FiberRoot | null = null, root: RR.FiberRoot | null = firstScheduledRoot;
      null !== root;

    ) {
      var next = root.next,
        nextLanes = scheduleTaskForRootDuringMicrotask(root, currentTime);
      if (0 === nextLanes)
        (root.next = null),
          null === prev ? (firstScheduledRoot = next) : (prev.next = next),
          null === next && (lastScheduledRoot = prev);
      else if (
        ((prev = root), 0 !== syncTransitionLanes || 0 !== (nextLanes & 3))
      )
        mightHavePendingSyncWork = !0;
      root = next;
    }
    (0 !== pendingEffectsStatus && 5 !== pendingEffectsStatus) ||
      flushSyncWorkAcrossRoots_impl(syncTransitionLanes, !1);
    0 !== currentEventTransitionLane && (currentEventTransitionLane = 0);
  }
  function scheduleTaskForRootDuringMicrotask(root: RR.FiberRoot, currentTime: RR.Milliseconds | RR.FiberRoot | RR.Lane | null): RR.Lane {
    for (
      var suspendedLanes: RR.Lanes | RR.SchedulerPriority | RR.SchedulerTask = root.suspendedLanes,
        pingedLanes: RR.Lanes | RR.SchedulerTask | RR.SchedulerCallback | null = root.pingedLanes,
        expirationTimes = root.expirationTimes,
        lanes = root.pendingLanes & -62914561;
      0 < lanes;

    ) {
      var index$3 = 31 - clz32(lanes),
        lane = 1 << index$3,
        expirationTime = expirationTimes[index$3]!;
      if (-1 === expirationTime) {
        if (0 === (lane & suspendedLanes) || 0 !== (lane & pingedLanes))
          expirationTimes[index$3] = computeExpirationTime(lane, (currentTime as RR.Milliseconds));
      } else expirationTime <= (currentTime as RR.Milliseconds) && (root.expiredLanes |= lane);
      lanes &= ~lane;
    }
    currentTime = workInProgressRoot;
    suspendedLanes = workInProgressRootRenderLanes;
    suspendedLanes = getNextLanes(
      root,
      root === currentTime ? suspendedLanes : 0,
      null !== root.cancelPendingCommit || root.timeoutHandle !== noTimeout
    );
    pingedLanes = ((root.callbackNode as RR.SchedulerTask | null | RR.Lanes) as RR.SchedulerTask | null);
    if (
      0 === suspendedLanes ||
      (root === currentTime &&
        (2 === workInProgressSuspendedReason ||
          9 === workInProgressSuspendedReason)) ||
      null !== root.cancelPendingCommit
    )
      return (
        null !== pingedLanes &&
          null !== pingedLanes &&
          cancelCallback$1(pingedLanes),
        (root.callbackNode = null),
        (root.callbackPriority = 0)
      );
    if (
      0 === (suspendedLanes & 3) ||
      checkIfRootIsPrerendering(root, suspendedLanes)
    ) {
      currentTime = suspendedLanes & -suspendedLanes;
      if (currentTime === root.callbackPriority) return currentTime;
      null !== pingedLanes && cancelCallback$1(pingedLanes);
      switch (lanesToEventPriority(suspendedLanes)) {
        case 2:
        case 8:
          suspendedLanes = UserBlockingPriority;
          break;
        case 32:
          suspendedLanes = NormalPriority$1;
          break;
        case 268435456:
          suspendedLanes = IdlePriority;
          break;
        default:
          suspendedLanes = NormalPriority$1;
      }
      pingedLanes = ((performWorkOnRootViaSchedulerTask.bind(null, root) as RR.SchedulerCallback | RR.Lanes) as RR.SchedulerCallback);
      suspendedLanes = scheduleCallback$3(suspendedLanes, pingedLanes);
      root.callbackPriority = currentTime;
      root.callbackNode = suspendedLanes;
      return currentTime;
    }
    null !== pingedLanes &&
      null !== pingedLanes &&
      cancelCallback$1(pingedLanes);
    root.callbackPriority = 2;
    root.callbackNode = null;
    return 2;
  }
  function performWorkOnRootViaSchedulerTask(root: RR.FiberRoot, didTimeout: boolean): RR.SchedulerCallback | null {
    if (0 !== pendingEffectsStatus && 5 !== pendingEffectsStatus)
      return (root.callbackNode = null), (root.callbackPriority = 0), null;
    var originalCallbackNode = root.callbackNode;
    if (flushPendingEffects() && root.callbackNode !== originalCallbackNode)
      return null;
    var workInProgressRootRenderLanes$jscomp$0 = workInProgressRootRenderLanes;
    workInProgressRootRenderLanes$jscomp$0 = getNextLanes(
      root,
      root === workInProgressRoot ? workInProgressRootRenderLanes$jscomp$0 : 0,
      null !== root.cancelPendingCommit || root.timeoutHandle !== noTimeout
    );
    if (0 === workInProgressRootRenderLanes$jscomp$0) return null;
    performWorkOnRoot(root, workInProgressRootRenderLanes$jscomp$0, didTimeout);
    scheduleTaskForRootDuringMicrotask(root, now());
    return null != root.callbackNode &&
      root.callbackNode === originalCallbackNode
      ? performWorkOnRootViaSchedulerTask.bind(null, root)
      : null;
  }
  function performSyncWorkOnRoot(root: RR.FiberRoot, lanes: RR.Lanes): null | undefined {
    if (flushPendingEffects()) return null;
    performWorkOnRoot(root, lanes, !0);
  }
  function scheduleImmediateRootScheduleTask(): void {
    supportsMicrotasks
      ? scheduleMicrotask!(function () {
          0 !== (executionContext & 6)
            ? scheduleCallback$3(
                ImmediatePriority,
                processRootScheduleInImmediateTask
              )
            : processRootScheduleInMicrotask();
        })
      : scheduleCallback$3(
          ImmediatePriority,
          processRootScheduleInImmediateTask
        );
  }
  function requestTransitionLane(): RR.Lane {
    if (0 === currentEventTransitionLane) {
      var actionScopeLane = currentEntangledLane;
      0 === actionScopeLane &&
        ((actionScopeLane = nextTransitionUpdateLane),
        (nextTransitionUpdateLane <<= 1),
        0 === (nextTransitionUpdateLane & 261888) &&
          (nextTransitionUpdateLane = 256));
      currentEventTransitionLane = actionScopeLane;
    }
    return currentEventTransitionLane;
  }
  function entangleAsyncAction(transition: RR.Transition, thenable: RR.Wakeable): RR.Wakeable {
    if (null === currentEntangledListeners) {
      var entangledListeners: Array<() => unknown> = (currentEntangledListeners = []);
      currentEntangledPendingCount = 0;
      currentEntangledLane = requestTransitionLane();
      currentEntangledActionThenable = {
        status: "pending",
        value: void 0,
        then: function (resolve) {
          entangledListeners.push(resolve);
        }
      };
    }
    currentEntangledPendingCount++;
    thenable.then(pingEngtangledActionScope, pingEngtangledActionScope);
    return thenable;
  }
  function pingEngtangledActionScope(): void {
    if (
      0 === --currentEntangledPendingCount &&
      null !== currentEntangledListeners
    ) {
      null !== currentEntangledActionThenable &&
        (currentEntangledActionThenable.status = "fulfilled");
      var listeners: Array<() => unknown> = currentEntangledListeners;
      currentEntangledListeners = null;
      currentEntangledLane = 0;
      currentEntangledActionThenable = null;
      for (var i = 0; i < listeners.length; i++) (0, (listeners as any)[i])();
    }
  }
  function chainThenableValue<T>(thenable: RR.Thenable<unknown>, result: T): RR.ChainedThenable<T> {
    var listeners: Array<(value?: T) => unknown> = [],
      thenableWithOverride: RR.ChainedThenable<T> = {
        status: "pending",
        value: null,
        reason: null,
        then: function (resolve) {
          listeners.push(resolve);
        }
      };
    thenable.then(
      function () {
        thenableWithOverride.status = "fulfilled";
        thenableWithOverride.value = result;
        for (var i = 0; i < listeners.length; i++) (0, (listeners as any)[i])(result);
      },
      function (error: RR.Thrown | number) {
        thenableWithOverride.status = "rejected";
        thenableWithOverride.reason = error;
        for (error = 0; (error as number) < listeners.length; error++)
          (0, (listeners as any)[(error as number)])(void 0);
      }
    );
    return thenableWithOverride;
  }
  function peekCacheFromPool(): RR.Cache | null {
    var cacheResumedFromPreviousRender = resumedCache.current;
    return null !== cacheResumedFromPreviousRender
      ? cacheResumedFromPreviousRender
      : workInProgressRoot!.pooledCache;
  }
  function pushTransition(offscreenWorkInProgress: RR.Fiber, prevCachePool: RR.SpawnedCachePool | null): void {
    null === prevCachePool
      ? push(resumedCache, resumedCache.current)
      : push(resumedCache, prevCachePool.pool);
  }
  function getSuspendedCache(): RR.SpawnedCachePool | null {
    var cacheFromPool = peekCacheFromPool();
    return null === cacheFromPool
      ? null
      : {
          parent: isPrimaryRenderer
            ? CacheContext._currentValue
            : CacheContext._currentValue2,
          pool: cacheFromPool
        };
  }
  function shallowEqual(objA: RR.Comparand, objB: RR.Comparand): boolean {
    if (objectIs(objA, objB)) return !0;
    if (
      "object" !== typeof objA ||
      null === objA ||
      "object" !== typeof objB ||
      null === objB
    )
      return !1;
    var keysA = Object.keys(objA),
      keysB: string[] | number = Object.keys(objB);
    if (keysA.length !== keysB.length) return !1;
    for (keysB = 0; keysB < keysA.length; keysB++) {
      var currentKey = keysA[keysB]!;
      if (
        !hasOwnProperty.call(objB, currentKey) ||
        !objectIs(objA[currentKey]!, objB[currentKey]!)
      )
        return !1;
    }
    return !0;
  }
  function isThenableResolved(thenable: RR.Thenable<unknown> | string | undefined): boolean {
    thenable = (thenable as RR.Thenable<unknown>).status;
    return "fulfilled" === thenable || "rejected" === thenable;
  }
  function trackUsedThenable<T>(thenableState: RR.ThenableState | RR.Thrown | RR.FiberRoot | RR.Thenable<T> | null, thenable: RR.Thenable<T>, index: number | RR.ThenableState[number] | undefined): T | undefined {
    index = (thenableState as RR.ThenableState)[(index as number)];
    void 0 === index
      ? (thenableState as RR.ThenableState).push(thenable)
      : index !== thenable &&
        (thenable.then(noop$1, noop$1), (thenable = (index as RR.ThenableState[number] | undefined)!));
    switch (thenable.status) {
      case "fulfilled":
        return thenable.value;
      case "rejected":
        throw (
          ((thenableState = thenable.reason),
          checkIfUseWrappedInAsyncCatch(thenableState),
          thenableState)
        );
      default:
        if ("string" === typeof thenable.status) thenable.then(noop$1, noop$1);
        else {
          thenableState = workInProgressRoot;
          if (null !== (thenableState as RR.FiberRoot | null) && 100 < (thenableState as RR.FiberRoot | null)!.shellSuspendCounter)
            throw Error(formatProdErrorMessage(482));
          thenableState = thenable;
          (thenableState as RR.Thenable<T>).status = "pending";
          (thenableState as RR.Thenable<T>).then(
            function (fulfilledValue: RR.UsedValue) {
              if ("pending" === thenable.status) {
                var fulfilledThenable = thenable;
                fulfilledThenable.status = "fulfilled";
                fulfilledThenable.value = fulfilledValue;
              }
            },
            function (error: RR.Thrown) {
              if ("pending" === thenable.status) {
                var rejectedThenable = thenable;
                rejectedThenable.status = "rejected";
                rejectedThenable.reason = error;
              }
            }
          );
        }
        switch (thenable.status) {
          case "fulfilled":
            return thenable.value;
          case "rejected":
            throw (
              ((thenableState = thenable.reason),
              checkIfUseWrappedInAsyncCatch(thenableState),
              thenableState)
            );
        }
        suspendedThenable = thenable;
        throw SuspenseException;
    }
  }
  function resolveLazy(lazyType: RR.LazyComponent): RR.LazyResult {
    try {
      var init = lazyType._init;
      return init(lazyType._payload);
    } catch (x: RR.Thrown) {
      if (null !== x && "object" === typeof x && "function" === typeof x.then)
        throw ((suspendedThenable = x), SuspenseException);
      throw x;
    }
  }
  function getSuspendedThenable(): RR.Thenable | RR.NoopThenable {
    if (null === suspendedThenable) throw Error(formatProdErrorMessage(459));
    var thenable = suspendedThenable;
    suspendedThenable = null;
    return thenable;
  }
  function checkIfUseWrappedInAsyncCatch(rejectedReason: RR.Thrown): void {
    if (
      rejectedReason === SuspenseException ||
      rejectedReason === SuspenseActionException
    )
      throw Error(formatProdErrorMessage(483));
  }
  function unwrapThenable(thenable: RR.Thenable<RR.ReactNode>): RR.ReactNode {
    var index = thenableIndexCounter$1;
    thenableIndexCounter$1 += 1;
    null === thenableState$1 && (thenableState$1 = []);
    return trackUsedThenable(thenableState$1, thenable, index);
  }
  function coerceRef(workInProgress: RR.Fiber, element: RR.ReactElement | RR.Ref | undefined): void {
    element = (element as RR.ReactElement).props.ref as RR.Ref | undefined;
    workInProgress.ref = void 0 !== element ? element : null;
  }
  function throwOnInvalidObjectTypeImpl(returnFiber: RR.Fiber | string, newChild: RR.ReactNode): never {
    if (newChild.$$typeof === REACT_LEGACY_ELEMENT_TYPE)
      throw Error(formatProdErrorMessage(525));
    returnFiber = Object.prototype.toString.call(newChild);
    throw Error(
      formatProdErrorMessage(
        31,
        "[object Object]" === returnFiber
          ? "object with keys {" + Object.keys(newChild).join(", ") + "}"
          : returnFiber
      )
    );
  }
  function createChildReconciler(shouldTrackSideEffects: boolean): RR.ChildReconciler {
    function deleteChild(returnFiber: RR.Fiber, childToDelete: RR.Fiber): void {
      if (shouldTrackSideEffects) {
        var deletions = returnFiber.deletions;
        null === deletions
          ? ((returnFiber.deletions = [childToDelete]),
            (returnFiber.flags |= 16))
          : deletions.push(childToDelete);
      }
    }
    function deleteRemainingChildren(returnFiber: RR.Fiber, currentFirstChild: RR.Fiber | null): null {
      if (!shouldTrackSideEffects) return null;
      for (; null !== currentFirstChild; )
        deleteChild(returnFiber, currentFirstChild),
          (currentFirstChild = currentFirstChild.sibling);
      return null;
    }
    function mapRemainingChildren(currentFirstChild: RR.Fiber | null): RR.ExistingChildren {
      for (var existingChildren: RR.ExistingChildren = new Map(); null !== currentFirstChild; )
        null !== currentFirstChild.key
          ? existingChildren.set(currentFirstChild.key, currentFirstChild)
          : existingChildren.set(currentFirstChild.index, currentFirstChild),
          (currentFirstChild = currentFirstChild.sibling);
      return existingChildren;
    }
    function useFiber(fiber: RR.Fiber, pendingProps: RR.Fiber["pendingProps"]): RR.Fiber {
      fiber = createWorkInProgress(fiber, pendingProps);
      fiber.index = 0;
      fiber.sibling = null;
      return fiber;
    }
    function placeChild(newFiber: RR.Fiber, lastPlacedIndex: number, newIndex: number | RR.Fiber | null): number {
      newFiber.index = (newIndex as number);
      if (!shouldTrackSideEffects)
        return (newFiber.flags |= 1048576), lastPlacedIndex;
      newIndex = newFiber.alternate;
      if (null !== newIndex)
        return (
          (newIndex = newIndex.index),
          newIndex < lastPlacedIndex
            ? ((newFiber.flags |= 67108866), lastPlacedIndex)
            : newIndex
        );
      newFiber.flags |= 67108866;
      return lastPlacedIndex;
    }
    function placeSingleChild(newFiber: RR.Fiber): RR.Fiber {
      shouldTrackSideEffects &&
        null === newFiber.alternate &&
        (newFiber.flags |= 67108866);
      return newFiber;
    }
    function updateTextNode(returnFiber: RR.Fiber, current: RR.Fiber | null, textContent: string, lanes: RR.Lanes): RR.Fiber {
      if (null === current || 6 !== current.tag)
        return (
          (current = createFiberFromText(textContent, returnFiber.mode, lanes)),
          (current.return = returnFiber),
          current
        );
      current = useFiber(current, textContent);
      current.return = returnFiber;
      return current;
    }
    function updateElement(returnFiber: RR.Fiber, current: RR.Fiber | null, element: RR.ReactElement, lanes: RR.Lanes): RR.Fiber {
      var elementType = element.type;
      if (elementType === REACT_FRAGMENT_TYPE)
        return updateFragment(
          returnFiber,
          current,
          element.props.children,
          lanes,
          element.key
        );
      if (
        null !== current &&
        (current.elementType === elementType ||
          ("object" === typeof elementType &&
            null !== elementType &&
            elementType.$$typeof === REACT_LAZY_TYPE &&
            resolveLazy(elementType) === current.type))
      )
        return (
          (current = useFiber(current, element.props)),
          coerceRef(current, element),
          (current.return = returnFiber),
          current
        );
      current = createFiberFromTypeAndProps(
        element.type,
        element.key,
        element.props,
        null,
        returnFiber.mode,
        lanes
      );
      coerceRef(current, element);
      current.return = returnFiber;
      return current;
    }
    function updatePortal(returnFiber: RR.Fiber, current: RR.Fiber | null, portal: RR.ReactPortal, lanes: RR.Lanes): RR.Fiber {
      if (
        null === current ||
        4 !== current.tag ||
        (current.stateNode as RR.PortalState).containerInfo !== portal.containerInfo ||
        (current.stateNode as RR.PortalState).implementation !== portal.implementation
      )
        return (
          (current = createFiberFromPortal(portal, returnFiber.mode, lanes)),
          (current.return = returnFiber),
          current
        );
      current = useFiber(current, portal.children || []);
      current.return = returnFiber;
      return current;
    }
    function updateFragment(returnFiber: RR.Fiber, current: RR.Fiber | null, fragment: RR.ReactNode, lanes: RR.Lanes, key: string | null): RR.Fiber {
      if (null === current || 7 !== current.tag)
        return (
          (current = createFiberFromFragment(
            fragment,
            returnFiber.mode,
            lanes,
            key
          )),
          (current.return = returnFiber),
          current
        );
      current = useFiber(current, fragment);
      current.return = returnFiber;
      return current;
    }
    function createChild(returnFiber: RR.Fiber, newChild: RR.ReactNode | RR.Fiber | RR.ReactElement, lanes: RR.Lanes | RR.Fiber): RR.Fiber | null {
      if (
        ("string" === typeof newChild && "" !== newChild) ||
        "number" === typeof newChild ||
        "bigint" === typeof newChild
      )
        return (
          (newChild = createFiberFromText(
            "" + newChild,
            returnFiber.mode,
            (lanes as RR.Lanes)
          )),
          ((newChild as RR.Fiber).return = returnFiber),
          (newChild as RR.Fiber)
        );
      if ("object" === typeof newChild && null !== newChild) {
        switch ((newChild as RR.ReactElement).$$typeof) {
          case REACT_ELEMENT_TYPE:
            return (
              (lanes = createFiberFromTypeAndProps(
                (newChild as RR.ReactElement).type,
                (newChild as RR.ReactElement).key,
                (newChild as RR.ReactElement).props,
                null,
                returnFiber.mode,
                (lanes as RR.Lanes)
              )),
              coerceRef(lanes, (newChild as RR.ReactElement)),
              (lanes.return = returnFiber),
              lanes
            );
          case REACT_PORTAL_TYPE:
            return (
              (newChild = createFiberFromPortal(
                newChild,
                returnFiber.mode,
                (lanes as RR.Lanes)
              )),
              ((newChild as RR.Fiber).return = returnFiber),
              (newChild as RR.Fiber)
            );
          case REACT_LAZY_TYPE:
            return (
              (newChild = resolveLazy(newChild)),
              createChild(returnFiber, newChild, (lanes as RR.Lanes))
            );
        }
        if (isArrayImpl(newChild) || getIteratorFn(newChild))
          return (
            (newChild = createFiberFromFragment(
              newChild,
              returnFiber.mode,
              (lanes as RR.Lanes),
              null
            )),
            ((newChild as RR.Fiber).return = returnFiber),
            (newChild as RR.Fiber)
          );
        if ("function" === typeof newChild.then)
          return createChild(returnFiber, unwrapThenable(newChild), (lanes as RR.Lanes));
        if (newChild.$$typeof === REACT_CONTEXT_TYPE)
          return createChild(
            returnFiber,
            readContextDuringReconciliation(returnFiber, newChild),
            (lanes as RR.Lanes)
          );
        throwOnInvalidObjectTypeImpl(returnFiber, newChild);
      }
      return null;
    }
    function updateSlot(returnFiber: RR.Fiber, oldFiber: RR.Fiber | null, newChild: RR.ReactNode | RR.ReactElement, lanes: RR.Lanes): RR.Fiber | null {
      var key = null !== oldFiber ? oldFiber.key : null;
      if (
        ("string" === typeof newChild && "" !== newChild) ||
        "number" === typeof newChild ||
        "bigint" === typeof newChild
      )
        return null !== key
          ? null
          : updateTextNode(returnFiber, oldFiber, "" + newChild, lanes);
      if ("object" === typeof newChild && null !== newChild) {
        switch ((newChild as RR.ReactElement).$$typeof) {
          case REACT_ELEMENT_TYPE:
            return (newChild as RR.ReactElement).key === key
              ? updateElement(returnFiber, oldFiber, (newChild as RR.ReactElement), lanes)
              : null;
          case REACT_PORTAL_TYPE:
            return newChild.key === key
              ? updatePortal(returnFiber, oldFiber, newChild, lanes)
              : null;
          case REACT_LAZY_TYPE:
            return (
              (newChild = resolveLazy(newChild)),
              updateSlot(returnFiber, oldFiber, newChild, lanes)
            );
        }
        if (isArrayImpl(newChild) || getIteratorFn(newChild))
          return null !== key
            ? null
            : updateFragment(returnFiber, oldFiber, newChild, lanes, null);
        if ("function" === typeof newChild.then)
          return updateSlot(
            returnFiber,
            oldFiber,
            unwrapThenable(newChild),
            lanes
          );
        if (newChild.$$typeof === REACT_CONTEXT_TYPE)
          return updateSlot(
            returnFiber,
            oldFiber,
            readContextDuringReconciliation(returnFiber, newChild),
            lanes
          );
        throwOnInvalidObjectTypeImpl(returnFiber, newChild);
      }
      return null;
    }
    function updateFromMap(
      existingChildren: RR.ExistingChildren | RR.Fiber | null,
      returnFiber: RR.Fiber,
      newIdx: number,
      newChild: RR.ReactNode | RR.ReactElement,
      lanes: RR.Lanes
    ): RR.Fiber | null {
      if (
        ("string" === typeof newChild && "" !== newChild) ||
        "number" === typeof newChild ||
        "bigint" === typeof newChild
      )
        return (
          (existingChildren = (existingChildren as RR.ExistingChildren).get(newIdx) || null),
          updateTextNode(returnFiber, (existingChildren as RR.Fiber | null), "" + newChild, lanes)
        );
      if ("object" === typeof newChild && null !== newChild) {
        switch ((newChild as RR.ReactElement).$$typeof) {
          case REACT_ELEMENT_TYPE:
            return (
              (existingChildren =
                (existingChildren as RR.ExistingChildren).get(
                  null === (newChild as RR.ReactElement).key ? newIdx : (newChild as RR.ReactElement).key!
                ) || null),
              updateElement(returnFiber, (existingChildren as RR.Fiber | null), (newChild as RR.ReactElement), lanes)
            );
          case REACT_PORTAL_TYPE:
            return (
              (existingChildren =
                (existingChildren as RR.ExistingChildren).get(
                  null === newChild.key ? newIdx : newChild.key
                ) || null),
              updatePortal(returnFiber, (existingChildren as RR.Fiber | null), newChild, lanes)
            );
          case REACT_LAZY_TYPE:
            return (
              (newChild = resolveLazy(newChild)),
              updateFromMap(
                (existingChildren as RR.ExistingChildren),
                returnFiber,
                newIdx,
                newChild,
                lanes
              )
            );
        }
        if (isArrayImpl(newChild) || getIteratorFn(newChild))
          return (
            (existingChildren = (existingChildren as RR.ExistingChildren).get(newIdx) || null),
            updateFragment(returnFiber, (existingChildren as RR.Fiber | null), newChild, lanes, null)
          );
        if ("function" === typeof newChild.then)
          return updateFromMap(
            (existingChildren as RR.ExistingChildren),
            returnFiber,
            newIdx,
            unwrapThenable(newChild),
            lanes
          );
        if (newChild.$$typeof === REACT_CONTEXT_TYPE)
          return updateFromMap(
            (existingChildren as RR.ExistingChildren),
            returnFiber,
            newIdx,
            readContextDuringReconciliation(returnFiber, newChild),
            lanes
          );
        throwOnInvalidObjectTypeImpl(returnFiber, newChild);
      }
      return null;
    }
    function reconcileChildrenArray(
      returnFiber: RR.Fiber,
      currentFirstChild: RR.Fiber | number | null,
      newChildren: RR.ReactNode[],
      lanes: RR.Lanes
    ): RR.Fiber | null {
      for (
        var resultingFirstChild: RR.Fiber | null = null,
          previousNewFiber: RR.Fiber | null = null,
          oldFiber: RR.Fiber | RR.ExistingChildren | null = (currentFirstChild as RR.Fiber | null),
          newIdx: number = (currentFirstChild = 0),
          nextOldFiber: RR.Fiber | null = null;
        null !== oldFiber && newIdx < newChildren.length;
        newIdx++
      ) {
        (oldFiber as RR.Fiber | null)!.index > newIdx
          ? ((nextOldFiber = (oldFiber as RR.Fiber | null)), (oldFiber = null))
          : (nextOldFiber = (oldFiber as RR.Fiber | null)!.sibling);
        var newFiber = updateSlot(
          returnFiber,
          (oldFiber as RR.Fiber | null),
          newChildren[newIdx],
          lanes
        );
        if (null === newFiber) {
          null === oldFiber && (oldFiber = nextOldFiber);
          break;
        }
        shouldTrackSideEffects &&
          oldFiber &&
          null === newFiber.alternate &&
          deleteChild(returnFiber, (oldFiber as RR.Fiber | null)!);
        currentFirstChild = placeChild(newFiber, currentFirstChild, newIdx);
        null === previousNewFiber
          ? (resultingFirstChild = newFiber)
          : (previousNewFiber.sibling = newFiber);
        previousNewFiber = newFiber;
        oldFiber = nextOldFiber;
      }
      if (newIdx === newChildren.length)
        return (
          deleteRemainingChildren(returnFiber, (oldFiber as RR.Fiber | null)),
          isHydrating && pushTreeFork(returnFiber, newIdx),
          resultingFirstChild
        );
      if (null === oldFiber) {
        for (; newIdx < newChildren.length; newIdx++)
          (oldFiber = createChild(returnFiber, newChildren[newIdx], lanes)),
            null !== oldFiber &&
              ((currentFirstChild = placeChild(
                oldFiber,
                currentFirstChild,
                newIdx
              )),
              null === previousNewFiber
                ? (resultingFirstChild = oldFiber)
                : (previousNewFiber.sibling = oldFiber),
              (previousNewFiber = oldFiber));
        isHydrating && pushTreeFork(returnFiber, newIdx);
        return resultingFirstChild;
      }
      for (
        oldFiber = mapRemainingChildren((oldFiber as RR.Fiber | null));
        newIdx < newChildren.length;
        newIdx++
      )
        (nextOldFiber = updateFromMap(
          oldFiber,
          returnFiber,
          newIdx,
          newChildren[newIdx],
          lanes
        )),
          null !== nextOldFiber &&
            (shouldTrackSideEffects &&
              null !== nextOldFiber.alternate &&
              oldFiber.delete(
                null === nextOldFiber.key ? newIdx : nextOldFiber.key
              ),
            (currentFirstChild = placeChild(
              nextOldFiber,
              currentFirstChild,
              newIdx
            )),
            null === previousNewFiber
              ? (resultingFirstChild = nextOldFiber)
              : (previousNewFiber.sibling = nextOldFiber),
            (previousNewFiber = nextOldFiber));
      shouldTrackSideEffects &&
        oldFiber.forEach(function (child) {
          return deleteChild(returnFiber, child);
        });
      isHydrating && pushTreeFork(returnFiber, newIdx);
      return resultingFirstChild;
    }
    function reconcileChildrenIterator(
      returnFiber: RR.Fiber,
      currentFirstChild: RR.Fiber | number | null,
      newChildren: RR.ChildIterator | null | undefined,
      lanes: RR.Lanes
    ): RR.Fiber | null {
      if (null == newChildren) throw Error(formatProdErrorMessage(151));
      for (
        var resultingFirstChild: RR.Fiber | null = null,
          previousNewFiber: RR.Fiber | null = null,
          oldFiber: RR.Fiber | RR.ExistingChildren | null = (currentFirstChild as RR.Fiber | null),
          newIdx: number = (currentFirstChild = 0),
          nextOldFiber: RR.Fiber | null = null,
          step: RR.ChildIteratorResult | RR.Fiber | null = newChildren.next();
        null !== oldFiber && !step.done;
        newIdx++, step = newChildren.next()
      ) {
        (oldFiber as RR.Fiber | null)!.index > newIdx
          ? ((nextOldFiber = (oldFiber as RR.Fiber | null)), (oldFiber = null))
          : (nextOldFiber = (oldFiber as RR.Fiber | null)!.sibling);
        var newFiber = updateSlot(returnFiber, (oldFiber as RR.Fiber | null), step.value, lanes);
        if (null === newFiber) {
          null === oldFiber && (oldFiber = nextOldFiber);
          break;
        }
        shouldTrackSideEffects &&
          oldFiber &&
          null === newFiber.alternate &&
          deleteChild(returnFiber, (oldFiber as RR.Fiber | null)!);
        currentFirstChild = placeChild(newFiber, currentFirstChild, newIdx);
        null === previousNewFiber
          ? (resultingFirstChild = newFiber)
          : (previousNewFiber.sibling = newFiber);
        previousNewFiber = newFiber;
        oldFiber = nextOldFiber;
      }
      if (step.done)
        return (
          deleteRemainingChildren(returnFiber, (oldFiber as RR.Fiber | null)),
          isHydrating && pushTreeFork(returnFiber, newIdx),
          resultingFirstChild
        );
      if (null === oldFiber) {
        for (; !step.done; newIdx++, step = newChildren.next())
          (step = createChild(returnFiber, step.value, lanes)),
            null !== step &&
              ((currentFirstChild = placeChild(
                step,
                currentFirstChild,
                newIdx
              )),
              null === previousNewFiber
                ? (resultingFirstChild = step)
                : (previousNewFiber.sibling = step),
              (previousNewFiber = step));
        isHydrating && pushTreeFork(returnFiber, newIdx);
        return resultingFirstChild;
      }
      for (
        oldFiber = mapRemainingChildren((oldFiber as RR.Fiber | null));
        !step.done;
        newIdx++, step = newChildren.next()
      )
        (step = updateFromMap(
          oldFiber,
          returnFiber,
          newIdx,
          step.value,
          lanes
        )),
          null !== step &&
            (shouldTrackSideEffects &&
              null !== step.alternate &&
              oldFiber.delete(null === step.key ? newIdx : step.key),
            (currentFirstChild = placeChild(step, currentFirstChild, newIdx)),
            null === previousNewFiber
              ? (resultingFirstChild = step)
              : (previousNewFiber.sibling = step),
            (previousNewFiber = step));
      shouldTrackSideEffects &&
        oldFiber.forEach(function (child) {
          return deleteChild(returnFiber, child);
        });
      isHydrating && pushTreeFork(returnFiber, newIdx);
      return resultingFirstChild;
    }
    function reconcileChildFibersImpl(
      returnFiber: RR.Fiber,
      currentFirstChild: RR.Fiber | null,
      newChild: RR.ReactNode | RR.ChildIterator | string | RR.ReactElement | null | undefined,
      lanes: RR.Lanes | RR.Fiber
    ): RR.Fiber | null {
      "object" === typeof newChild &&
        null !== newChild &&
        (newChild as RR.ReactElement).type === REACT_FRAGMENT_TYPE &&
        null === (newChild as RR.ReactElement).key &&
        (newChild = (newChild as RR.ReactElement).props.children);
      if ("object" === typeof newChild && null !== newChild) {
        switch ((newChild as RR.ReactElement).$$typeof) {
          case REACT_ELEMENT_TYPE:
            a: {
              for (var key: string | RR.ReactElement["type"] | RR.IteratorFn | null = (newChild as RR.ReactElement).key; null !== currentFirstChild; ) {
                if (currentFirstChild.key === key) {
                  key = (newChild as RR.ReactElement).type;
                  if (key === REACT_FRAGMENT_TYPE) {
                    if (7 === currentFirstChild.tag) {
                      deleteRemainingChildren(
                        returnFiber,
                        currentFirstChild.sibling
                      );
                      lanes = useFiber(
                        currentFirstChild,
                        (newChild as RR.ReactElement).props.children
                      );
                      lanes.return = returnFiber;
                      returnFiber = lanes;
                      break a;
                    }
                  } else if (
                    currentFirstChild.elementType === key ||
                    ("object" === typeof key &&
                      null !== key &&
                      key.$$typeof === REACT_LAZY_TYPE &&
                      resolveLazy(key) === currentFirstChild.type)
                  ) {
                    deleteRemainingChildren(
                      returnFiber,
                      currentFirstChild.sibling
                    );
                    lanes = useFiber(currentFirstChild, (newChild as RR.ReactElement).props);
                    coerceRef(lanes, (newChild as RR.ReactElement));
                    lanes.return = returnFiber;
                    returnFiber = lanes;
                    break a;
                  }
                  deleteRemainingChildren(returnFiber, currentFirstChild);
                  break;
                } else deleteChild(returnFiber, currentFirstChild);
                currentFirstChild = currentFirstChild.sibling;
              }
              (newChild as RR.ReactElement).type === REACT_FRAGMENT_TYPE
                ? ((lanes = createFiberFromFragment(
                    (newChild as RR.ReactElement).props.children,
                    returnFiber.mode,
                    (lanes as RR.Lanes),
                    (newChild as RR.ReactElement).key
                  )),
                  (lanes.return = returnFiber),
                  (returnFiber = lanes))
                : ((lanes = createFiberFromTypeAndProps(
                    (newChild as RR.ReactElement).type,
                    (newChild as RR.ReactElement).key,
                    (newChild as RR.ReactElement).props,
                    null,
                    returnFiber.mode,
                    (lanes as RR.Lanes)
                  )),
                  coerceRef(lanes, (newChild as RR.ReactElement)),
                  (lanes.return = returnFiber),
                  (returnFiber = lanes));
            }
            return placeSingleChild(returnFiber);
          case REACT_PORTAL_TYPE:
            a: {
              for (key = newChild.key; null !== currentFirstChild; ) {
                if (currentFirstChild.key === key)
                  if (
                    4 === currentFirstChild.tag &&
                    (currentFirstChild.stateNode as RR.PortalState).containerInfo ===
                      newChild.containerInfo &&
                    (currentFirstChild.stateNode as RR.PortalState).implementation ===
                      newChild.implementation
                  ) {
                    deleteRemainingChildren(
                      returnFiber,
                      currentFirstChild.sibling
                    );
                    lanes = useFiber(
                      currentFirstChild,
                      newChild.children || []
                    );
                    lanes.return = returnFiber;
                    returnFiber = lanes;
                    break a;
                  } else {
                    deleteRemainingChildren(returnFiber, currentFirstChild);
                    break;
                  }
                else deleteChild(returnFiber, currentFirstChild);
                currentFirstChild = currentFirstChild.sibling;
              }
              lanes = createFiberFromPortal(newChild, returnFiber.mode, (lanes as RR.Lanes));
              lanes.return = returnFiber;
              returnFiber = lanes;
            }
            return placeSingleChild(returnFiber);
          case REACT_LAZY_TYPE:
            return (
              (newChild = resolveLazy(newChild)),
              reconcileChildFibersImpl(
                returnFiber,
                currentFirstChild,
                newChild,
                (lanes as RR.Lanes)
              )
            );
        }
        if (isArrayImpl(newChild))
          return reconcileChildrenArray(
            returnFiber,
            currentFirstChild,
            newChild,
            (lanes as RR.Lanes)
          );
        if (getIteratorFn(newChild)) {
          key = getIteratorFn(newChild);
          if ("function" !== typeof key)
            throw Error(formatProdErrorMessage(150));
          newChild = key.call(newChild);
          return reconcileChildrenIterator(
            returnFiber,
            currentFirstChild,
            (newChild as RR.ChildIterator | null | undefined),
            (lanes as RR.Lanes)
          );
        }
        if ("function" === typeof newChild.then)
          return reconcileChildFibersImpl(
            returnFiber,
            currentFirstChild,
            unwrapThenable(newChild),
            (lanes as RR.Lanes)
          );
        if (newChild.$$typeof === REACT_CONTEXT_TYPE)
          return reconcileChildFibersImpl(
            returnFiber,
            currentFirstChild,
            readContextDuringReconciliation(returnFiber, newChild),
            (lanes as RR.Lanes)
          );
        throwOnInvalidObjectTypeImpl(returnFiber, newChild);
      }
      return ("string" === typeof newChild && "" !== newChild) ||
        "number" === typeof newChild ||
        "bigint" === typeof newChild
        ? ((newChild = "" + newChild),
          null !== currentFirstChild && 6 === currentFirstChild.tag
            ? (deleteRemainingChildren(returnFiber, currentFirstChild.sibling),
              (lanes = useFiber(currentFirstChild, (newChild as string))),
              (lanes.return = returnFiber),
              (returnFiber = lanes))
            : (deleteRemainingChildren(returnFiber, currentFirstChild),
              (lanes = createFiberFromText((newChild as string), returnFiber.mode, (lanes as RR.Lanes))),
              (lanes.return = returnFiber),
              (returnFiber = lanes)),
          placeSingleChild(returnFiber))
        : deleteRemainingChildren(returnFiber, currentFirstChild);
    }
    return function (returnFiber, currentFirstChild, newChild, lanes) {
      try {
        thenableIndexCounter$1 = 0;
        var firstChildFiber = reconcileChildFibersImpl(
          returnFiber,
          currentFirstChild,
          newChild,
          lanes as RR.Lanes
        );
        thenableState$1 = null;
        return firstChildFiber;
      } catch (x) {
        if (x === SuspenseException || x === SuspenseActionException) throw x;
        var fiber = createFiber(29, x, null, returnFiber.mode);
        fiber.lanes = lanes as RR.Lanes;
        fiber.return = returnFiber;
        return fiber;
      } finally {
      }
    };
  }
  function finishQueueingConcurrentUpdates(): void {
    for (
      var endIndex = concurrentQueuesIndex,
        i = (concurrentlyUpdatedLanes = concurrentQueuesIndex = 0);
      i < endIndex;

    ) {
      var fiber: RR.Fiber = concurrentQueues[i] as RR.Fiber;
      concurrentQueues[i++] = null;
      var queue: RR.ConcurrentQueue | null = concurrentQueues[i] as RR.ConcurrentQueue | null;
      concurrentQueues[i++] = null;
      var update: RR.ConcurrentUpdate | null = concurrentQueues[i] as RR.ConcurrentUpdate | null;
      concurrentQueues[i++] = null;
      var lane: RR.Lane = concurrentQueues[i] as RR.Lane;
      concurrentQueues[i++] = null;
      if (null !== queue && null !== update) {
        var pending = queue.pending;
        null === pending
          ? (update.next = update)
          : ((update.next = pending.next), (pending.next = update));
        queue.pending = update;
      }
      0 !== lane && markUpdateLaneFromFiberToRoot(fiber, update, lane);
    }
  }
  function enqueueUpdate$1(fiber: RR.Fiber | null, queue: RR.ConcurrentQueue | null, update: RR.ConcurrentUpdate | null, lane: RR.Lane): void {
    concurrentQueues[concurrentQueuesIndex++] = fiber!;
    concurrentQueues[concurrentQueuesIndex++] = queue;
    concurrentQueues[concurrentQueuesIndex++] = update;
    concurrentQueues[concurrentQueuesIndex++] = lane;
    concurrentlyUpdatedLanes |= lane;
    fiber!.lanes |= lane;
    fiber = fiber!.alternate;
    null !== fiber && (fiber.lanes |= lane);
  }
  function enqueueConcurrentHookUpdate(fiber: RR.Fiber, queue: RR.HookQueue, update: RR.HookUpdate, lane: RR.Lane): RR.FiberRoot | null {
    enqueueUpdate$1(fiber, queue, update, lane);
    return getRootForUpdatedFiber(fiber);
  }
  function enqueueConcurrentRenderForLane(fiber: RR.Fiber, lane: RR.Lane): RR.FiberRoot | null {
    enqueueUpdate$1(fiber, null, null, lane);
    return getRootForUpdatedFiber(fiber);
  }
  function markUpdateLaneFromFiberToRoot(sourceFiber: RR.Fiber | RR.OffscreenInstance | RR.FiberRoot["hiddenUpdates"] | null, update: RR.ConcurrentUpdate | null, lane: RR.Lane): RR.FiberRoot | null {
    (sourceFiber as RR.Fiber).lanes |= lane;
    var alternate: RR.Fiber | RR.ConcurrentUpdate[] | null = (sourceFiber as RR.Fiber).alternate;
    null !== alternate && ((alternate as RR.Fiber | null)!.lanes |= lane);
    for (var isHidden: boolean | number = !1, parent: RR.Fiber | RR.FiberRoot | null = (sourceFiber as RR.Fiber).return; null !== parent; )
      ((parent as RR.Fiber | null)!.childLanes |= lane),
        (alternate = (parent as RR.Fiber | null)!.alternate),
        null !== alternate && ((alternate as RR.Fiber | null)!.childLanes |= lane),
        22 === parent.tag &&
          ((sourceFiber = (parent as RR.Fiber | null)!.stateNode as RR.OffscreenInstance | null),
          null === sourceFiber ||
            sourceFiber._visibility & 1 ||
            (isHidden = !0)),
        (sourceFiber = (parent as RR.Fiber | null)),
        (parent = (parent as RR.Fiber | null)!.return);
    return 3 === (sourceFiber as RR.Fiber).tag
      ? ((parent = (sourceFiber as RR.Fiber).stateNode as RR.FiberRoot),
        isHidden &&
          null !== update &&
          ((isHidden = 31 - clz32(lane)),
          (sourceFiber = parent.hiddenUpdates),
          (alternate = sourceFiber[isHidden]!),
          null === alternate
            ? (sourceFiber[isHidden] = [update])
            : alternate.push(update),
          (update.lane = lane | 536870912)),
        parent)
      : null;
  }
  function getRootForUpdatedFiber(sourceFiber: RR.Fiber): RR.FiberRoot | null {
    if (50 < nestedUpdateCount)
      throw (
        ((nestedUpdateCount = 0),
        (rootWithNestedUpdates = null),
        Error(formatProdErrorMessage(185)))
      );
    for (var parent = sourceFiber.return; null !== parent; )
      (sourceFiber = parent), (parent = sourceFiber.return);
    return 3 === sourceFiber.tag ? sourceFiber.stateNode as RR.FiberRoot : null;
  }
  function initializeUpdateQueue(fiber: RR.Fiber): void {
    fiber.updateQueue = {
      baseState: fiber.memoizedState,
      firstBaseUpdate: null,
      lastBaseUpdate: null,
      shared: { pending: null, lanes: 0, hiddenCallbacks: null },
      callbacks: null
    } as RR.UpdateQueue;
  }
  function cloneUpdateQueue(current: RR.Fiber | RR.UpdateQueue, workInProgress: RR.Fiber): void {
    current = (current as RR.Fiber).updateQueue as RR.UpdateQueue;
    workInProgress.updateQueue === current &&
      (workInProgress.updateQueue = {
        baseState: current.baseState,
        firstBaseUpdate: current.firstBaseUpdate,
        lastBaseUpdate: current.lastBaseUpdate,
        shared: current.shared,
        callbacks: null
      } as RR.UpdateQueue);
  }
  function createUpdate(lane: RR.Lane): RR.Update {
    return { lane: lane, tag: 0, payload: null, callback: null, next: null };
  }
  function enqueueUpdate(fiber: RR.Fiber, update: RR.Update | RR.FiberRoot | null, lane: RR.Lane): RR.FiberRoot | null {
    var updateQueue: RR.UpdateQueue | RR.SharedQueue | null = fiber.updateQueue as RR.UpdateQueue | null;
    if (null === updateQueue) return null;
    updateQueue = updateQueue.shared;
    if (0 !== (executionContext & 2)) {
      var pending = updateQueue.pending;
      null === pending
        ? ((update as RR.Update).next = (update as RR.Update))
        : (((update as RR.Update).next = pending.next), (pending.next = (update as RR.Update)));
      (updateQueue as RR.SharedQueue).pending = (update as RR.Update);
      update = getRootForUpdatedFiber(fiber);
      markUpdateLaneFromFiberToRoot(fiber, null, lane);
      return update;
    }
    enqueueUpdate$1(fiber, updateQueue, (update as RR.Update), lane);
    return getRootForUpdatedFiber(fiber);
  }
  function entangleTransitions(root: RR.FiberRoot, fiber: RR.Fiber | RR.UpdateQueue | RR.SharedQueue | null, lane: RR.Lane): void {
    fiber = (fiber as RR.Fiber).updateQueue as RR.UpdateQueue | null;
    if (null !== fiber && ((fiber = fiber.shared), 0 !== (lane & 4194048))) {
      var queueLanes = fiber.lanes;
      queueLanes &= root.pendingLanes;
      lane |= queueLanes;
      fiber.lanes = lane;
      markRootEntangled(root, lane);
    }
  }
  function enqueueCapturedUpdate(workInProgress: RR.Fiber | RR.Update | null, capturedUpdate: RR.Update): void {
    var queue: RR.UpdateQueue | RR.Update | null = (workInProgress as RR.Fiber).updateQueue as RR.UpdateQueue,
      current: RR.Fiber | RR.FiberUpdateQueue | null = (workInProgress as RR.Fiber).alternate;
    if (
      null !== current &&
      ((current = (current as RR.Fiber | null)!.updateQueue), queue === current)
    ) {
      var newFirst: RR.Update | null = null,
        newLast: RR.Update | null = null as RR.Update | null;
      queue = queue.firstBaseUpdate;
      if (null !== queue) {
        do {
          var clone: RR.Update = {
            lane: queue.lane,
            tag: queue.tag,
            payload: queue.payload,
            callback: null,
            next: null
          };
          null === newLast
            ? (newFirst = newLast = clone)
            : (newLast = newLast.next = clone);
          queue = queue.next;
        } while (null !== queue);
        null === newLast
          ? (newFirst = newLast = capturedUpdate)
          : (newLast = newLast.next = capturedUpdate);
      } else newFirst = newLast = capturedUpdate;
      queue = {
        baseState: current.baseState,
        firstBaseUpdate: newFirst,
        lastBaseUpdate: newLast,
        shared: current.shared,
        callbacks: current.callbacks
      } as RR.UpdateQueue;
      (workInProgress as RR.Fiber).updateQueue = queue;
      return;
    }
    workInProgress = queue.lastBaseUpdate;
    null === workInProgress
      ? (queue.firstBaseUpdate = capturedUpdate)
      : (workInProgress.next = capturedUpdate);
    queue.lastBaseUpdate = capturedUpdate;
  }
  function suspendIfUpdateReadFromEntangledAsyncAction(): void {
    if (didReadFromEntangledAsyncAction) {
      var entangledActionThenable = currentEntangledActionThenable;
      if (null !== entangledActionThenable) throw entangledActionThenable;
    }
  }
  function processUpdateQueue(
    workInProgress$jscomp$0: RR.Fiber,
    props: RR.Props | null,
    instance$jscomp$0: RR.ClassInstance | null,
    renderLanes: RR.Lanes
  ): void {
    didReadFromEntangledAsyncAction = !1;
    var queue: RR.UpdateQueue = workInProgress$jscomp$0.updateQueue as RR.UpdateQueue;
    hasForceUpdate = !1;
    var firstBaseUpdate: RR.Update | null = queue.firstBaseUpdate,
      lastBaseUpdate: RR.Update | RR.Lanes | null = ((queue.lastBaseUpdate as RR.Update | null | RR.Lanes) as RR.Update | null),
      pendingQueue: RR.Update | null = queue.shared.pending;
    if (null !== pendingQueue) {
      queue.shared.pending = null;
      var lastPendingUpdate: RR.Update | RR.State = pendingQueue,
        firstPendingUpdate: RR.Update | null = lastPendingUpdate.next;
      lastPendingUpdate.next = null;
      null === lastBaseUpdate
        ? (firstBaseUpdate = firstPendingUpdate)
        : (lastBaseUpdate.next = firstPendingUpdate);
      lastBaseUpdate = lastPendingUpdate;
      var current: RR.Fiber | RR.UpdateQueue | RR.Update | null = workInProgress$jscomp$0.alternate;
      null !== current &&
        ((current = current.updateQueue as RR.UpdateQueue),
        (pendingQueue = current.lastBaseUpdate),
        pendingQueue !== lastBaseUpdate &&
          (null === pendingQueue
            ? (current.firstBaseUpdate = firstPendingUpdate)
            : (pendingQueue.next = firstPendingUpdate),
          (current.lastBaseUpdate = lastPendingUpdate)));
    }
    if (null !== firstBaseUpdate) {
      var newState: RR.State = queue.baseState;
      lastBaseUpdate = 0;
      current = (firstPendingUpdate = lastPendingUpdate = null) as RR.Update | null;
      pendingQueue = firstBaseUpdate;
      do {
        var updateLane: RR.Lane | RR.Props | RR.Carried | RR.UpdateCallback | null = pendingQueue.lane & -536870913,
          isHiddenUpdate: boolean | RR.UpdateCallback[] | RR.Update | null = updateLane !== pendingQueue.lane;
        if (
          isHiddenUpdate
            ? (workInProgressRootRenderLanes & updateLane) === updateLane
            : (renderLanes & updateLane) === updateLane
        ) {
          0 !== updateLane &&
            updateLane === currentEntangledLane &&
            (didReadFromEntangledAsyncAction = !0);
          null !== current &&
            (current = current.next =
              {
                lane: 0,
                tag: pendingQueue.tag,
                payload: pendingQueue.payload,
                callback: null,
                next: null
              });
          a: {
            var workInProgress: RR.Fiber | RR.StateUpdater | RR.Carried = workInProgress$jscomp$0,
              update: RR.Update = pendingQueue;
            updateLane = props;
            var instance: RR.ClassInstance | null = instance$jscomp$0;
            switch (update.tag) {
              case 1:
                workInProgress = update.payload;
                if ("function" === typeof workInProgress) {
                  newState = workInProgress.call(
                    instance,
                    newState,
                    (updateLane as RR.Props | null)
                  );
                  break a;
                }
                newState = (workInProgress as RR.StateUpdater | RR.Carried) as RR.State;
                break a;
              case 3:
                workInProgress.flags = (workInProgress.flags & -65537) | 128;
              case 0:
                workInProgress = update.payload;
                updateLane =
                  "function" === typeof workInProgress
                    ? workInProgress.call(instance, newState, (updateLane as RR.Props | null))
                    : (workInProgress as RR.StateUpdater | RR.Carried);
                if (null === (updateLane as RR.Carried) || void 0 === (updateLane as RR.Carried)) break a;
                newState = assign({}, newState, (updateLane as RR.Carried));
                break a;
              case 2:
                hasForceUpdate = !0;
            }
          }
          updateLane = pendingQueue.callback;
          null !== updateLane &&
            ((workInProgress$jscomp$0.flags |= 64),
            isHiddenUpdate && (workInProgress$jscomp$0.flags |= 8192),
            (isHiddenUpdate = queue.callbacks),
            null === isHiddenUpdate
              ? (queue.callbacks = [updateLane])
              : isHiddenUpdate.push(updateLane));
        } else
          (isHiddenUpdate = {
            lane: updateLane,
            tag: pendingQueue.tag,
            payload: pendingQueue.payload,
            callback: pendingQueue.callback,
            next: null
          } as RR.Update),
            null === current
              ? ((firstPendingUpdate = current = isHiddenUpdate),
                (lastPendingUpdate = newState))
              : (current = current.next = isHiddenUpdate),
            (lastBaseUpdate |= updateLane);
        pendingQueue = pendingQueue.next;
        if (null === pendingQueue)
          if (((pendingQueue = queue.shared.pending), null === pendingQueue))
            break;
          else
            (isHiddenUpdate = pendingQueue),
              (pendingQueue = isHiddenUpdate.next!),
              (isHiddenUpdate.next = null),
              (queue.lastBaseUpdate = isHiddenUpdate),
              (queue.shared.pending = null);
      } while (1);
      null === current && (lastPendingUpdate = newState);
      queue.baseState = lastPendingUpdate;
      queue.firstBaseUpdate = firstPendingUpdate;
      queue.lastBaseUpdate = current;
      null === firstBaseUpdate && (queue.shared.lanes = 0);
      workInProgressRootSkippedLanes |= lastBaseUpdate;
      workInProgress$jscomp$0.lanes = lastBaseUpdate;
      workInProgress$jscomp$0.memoizedState = newState;
    }
  }
  function callCallback(callback: RR.UpdateCallback, context: RR.StateNode): void {
    if ("function" !== typeof callback)
      throw Error(formatProdErrorMessage(191, callback));
    callback.call(context);
  }
  function commitCallbacks(updateQueue: RR.UpdateQueue | number, context: RR.StateNode): void {
    var callbacks = (updateQueue as RR.UpdateQueue).callbacks;
    if (null !== callbacks)
      for (
        (updateQueue as RR.UpdateQueue).callbacks = null, updateQueue = 0;
        updateQueue < callbacks.length;
        updateQueue++
      )
        callCallback(callbacks[updateQueue]!, context);
  }
  function pushHiddenContext(fiber: RR.Fiber | RR.Lanes, context: RR.HiddenContext): void {
    fiber = entangledRenderLanes;
    push(prevEntangledRenderLanesCursor, fiber);
    push(currentTreeHiddenStackCursor, context);
    entangledRenderLanes = fiber | context.baseLanes;
  }
  function reuseHiddenContextOnStack(): void {
    push(prevEntangledRenderLanesCursor, entangledRenderLanes);
    push(currentTreeHiddenStackCursor, currentTreeHiddenStackCursor.current);
  }
  function popHiddenContext(): void {
    entangledRenderLanes = prevEntangledRenderLanesCursor.current as RR.Lanes;
    pop(currentTreeHiddenStackCursor);
    pop(prevEntangledRenderLanesCursor);
  }
  function pushPrimaryTreeSuspenseHandler(handler: RR.Fiber): void {
    var current = handler.alternate;
    push(suspenseStackCursor, suspenseStackCursor.current & 1);
    push(suspenseHandlerStackCursor, handler);
    null === shellBoundary &&
      (null === current || null !== currentTreeHiddenStackCursor.current
        ? (shellBoundary = handler)
        : null !== current.memoizedState && (shellBoundary = handler));
  }
  function pushDehydratedActivitySuspenseHandler(fiber: RR.Fiber): void {
    push(suspenseStackCursor, suspenseStackCursor.current);
    push(suspenseHandlerStackCursor, fiber);
    null === shellBoundary && (shellBoundary = fiber);
  }
  function pushOffscreenSuspenseHandler(fiber: RR.Fiber): void {
    22 === fiber.tag
      ? (push(suspenseStackCursor, suspenseStackCursor.current),
        push(suspenseHandlerStackCursor, fiber),
        null === shellBoundary && (shellBoundary = fiber))
      : reuseSuspenseHandlerOnStack(fiber);
  }
  function reuseSuspenseHandlerOnStack(fiber?: RR.Fiber): void; function reuseSuspenseHandlerOnStack(): void {
    push(suspenseStackCursor, suspenseStackCursor.current);
    push(suspenseHandlerStackCursor, suspenseHandlerStackCursor.current);
  }
  function popSuspenseHandler(fiber: RR.Fiber): void {
    pop(suspenseHandlerStackCursor);
    shellBoundary === fiber && (shellBoundary = null);
    pop(suspenseStackCursor);
  }
  function findFirstSuspended(row: RR.Fiber): RR.Fiber | null {
    for (var node = row; null !== node; ) {
      if (13 === node.tag) {
        var state: RR.SuspenseState | RR.SuspenseInstance | null = node.memoizedState as RR.SuspenseState | null;
        if (
          null !== state &&
          ((state = state.dehydrated),
          null === state ||
            isSuspenseInstancePending!(state) ||
            isSuspenseInstanceFallback!(state))
        )
          return node;
      } else if (
        19 === node.tag &&
        ("forwards" === node.memoizedProps.revealOrder ||
          "backwards" === node.memoizedProps.revealOrder ||
          "unstable_legacy-backwards" === node.memoizedProps.revealOrder ||
          "together" === node.memoizedProps.revealOrder)
      ) {
        if (0 !== (node.flags & 128)) return node;
      } else if (null !== node.child) {
        node.child.return = node;
        node = node.child;
        continue;
      }
      if (node === row) break;
      for (; null === node.sibling; ) {
        if (null === node.return || node.return === row) return null;
        node = node.return;
      }
      node.sibling.return = node.return;
      node = node.sibling;
    }
    return null;
  }
  function throwInvalidHookError(): never {
    throw Error(formatProdErrorMessage(321));
  }
  function areHookInputsEqual(nextDeps: RR.HookDeps, prevDeps: RR.HookDeps | null): boolean {
    if (null === prevDeps) return !1;
    for (var i = 0; i < prevDeps.length && i < nextDeps.length; i++)
      if (!objectIs(nextDeps[i], prevDeps[i])) return !1;
    return !0;
  }
  function renderWithHooks(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.FunctionComponent,
    props: RR.Props | null,
    secondArg: RR.Ref | undefined,
    nextRenderLanes: RR.Lanes | RR.ReactNode
  ): RR.ReactNode {
    renderLanes = (nextRenderLanes as RR.Lanes);
    currentlyRenderingFiber = workInProgress;
    workInProgress.memoizedState = null;
    workInProgress.updateQueue = null;
    workInProgress.lanes = 0;
    ReactSharedInternals.H =
      null === current || null === current.memoizedState
        ? HooksDispatcherOnMount
        : HooksDispatcherOnUpdate;
    shouldDoubleInvokeUserFnsInHooksDEV = !1;
    nextRenderLanes = Component(props, secondArg);
    shouldDoubleInvokeUserFnsInHooksDEV = !1;
    didScheduleRenderPhaseUpdateDuringThisPass &&
      (nextRenderLanes = renderWithHooksAgain(
        workInProgress,
        Component,
        props,
        secondArg
      ));
    finishRenderingHooks(current);
    return nextRenderLanes;
  }
  function finishRenderingHooks(current: RR.Fiber | RR.Dependencies | null): void {
    ReactSharedInternals.H = ContextOnlyDispatcher;
    var didRenderTooFewHooks =
      null !== currentHook && null !== currentHook.next;
    renderLanes = 0;
    workInProgressHook = currentHook = currentlyRenderingFiber = null;
    didScheduleRenderPhaseUpdate = !1;
    thenableIndexCounter = 0;
    thenableState = null;
    if (didRenderTooFewHooks) throw Error(formatProdErrorMessage(300));
    null === (current as RR.Fiber | null) ||
      didReceiveUpdate ||
      ((current = (current as RR.Fiber | null)!.dependencies),
      null !== current &&
        checkIfContextChanged((current as RR.Dependencies | null)) &&
        (didReceiveUpdate = !0));
  }
  function renderWithHooksAgain(workInProgress: RR.Fiber, Component: RR.FunctionComponent, props: RR.Props | null, secondArg: RR.Ref | undefined): RR.ReactNode {
    currentlyRenderingFiber = workInProgress;
    var numberOfReRenders = 0;
    do {
      didScheduleRenderPhaseUpdateDuringThisPass && (thenableState = null);
      thenableIndexCounter = 0;
      didScheduleRenderPhaseUpdateDuringThisPass = !1;
      if (25 <= numberOfReRenders) throw Error(formatProdErrorMessage(301));
      numberOfReRenders += 1;
      workInProgressHook = currentHook = null;
      if (null != workInProgress.updateQueue) {
        var children: RR.FunctionComponentUpdateQueue | RR.ReactNode = workInProgress.updateQueue as RR.FunctionComponentUpdateQueue;
        (children as RR.FunctionComponentUpdateQueue).lastEffect = null;
        (children as RR.FunctionComponentUpdateQueue).events = null;
        (children as RR.FunctionComponentUpdateQueue).stores = null;
        null != (children as RR.FunctionComponentUpdateQueue).memoCache && ((children as RR.FunctionComponentUpdateQueue).memoCache!.index = 0);
      }
      ReactSharedInternals.H = HooksDispatcherOnRerender;
      children = Component(props, secondArg);
    } while (didScheduleRenderPhaseUpdateDuringThisPass);
    return children;
  }
  function TransitionAwareHostComponent(): RR.TransitionStatus {
    var dispatcher: RR.Dispatcher | RR.HookState | null = ReactSharedInternals.H,
      maybeThenable = (dispatcher as RR.Dispatcher | null)!.useState()[0];
    maybeThenable =
      "function" === typeof maybeThenable.then
        ? useThenable(maybeThenable)
        : maybeThenable;
    dispatcher = (dispatcher as RR.Dispatcher | null)!.useState()[0];
    (null !== currentHook ? currentHook.memoizedState : null) !== dispatcher &&
      (currentlyRenderingFiber!.flags |= 1024);
    return maybeThenable;
  }
  function checkDidRenderIdHook(): boolean {
    var didRenderIdHook = 0 !== localIdCounter;
    localIdCounter = 0;
    return didRenderIdHook;
  }
  function bailoutHooks(current: RR.Fiber, workInProgress: RR.Fiber, lanes: RR.Lanes): void {
    workInProgress.updateQueue = current.updateQueue;
    workInProgress.flags &= -2053;
    current.lanes &= ~lanes;
  }
  function resetHooksOnUnwind(workInProgress: RR.Fiber | RR.Hook | null): void {
    if (didScheduleRenderPhaseUpdate) {
      for (
        workInProgress = (workInProgress as RR.Fiber).memoizedState as RR.Hook | null;
        null !== workInProgress;

      ) {
        var queue = workInProgress.queue;
        null !== queue && (queue.pending = null);
        workInProgress = workInProgress.next;
      }
      didScheduleRenderPhaseUpdate = !1;
    }
    renderLanes = 0;
    workInProgressHook = currentHook = currentlyRenderingFiber = null;
    didScheduleRenderPhaseUpdateDuringThisPass = !1;
    thenableIndexCounter = localIdCounter = 0;
    thenableState = null;
  }
  function mountWorkInProgressHook(): RR.Hook {
    var hook: RR.Hook = {
      memoizedState: null,
      baseState: null,
      baseQueue: null,
      queue: null,
      next: null
    };
    null === workInProgressHook
      ? (currentlyRenderingFiber!.memoizedState = workInProgressHook = hook)
      : (workInProgressHook = workInProgressHook.next = hook);
    return workInProgressHook;
  }
  function updateWorkInProgressHook(): RR.Hook {
    if (null === currentHook) {
      var nextCurrentHook: RR.Fiber | RR.Hook | null = currentlyRenderingFiber!.alternate;
      nextCurrentHook =
        null !== nextCurrentHook ? nextCurrentHook.memoizedState as RR.Hook | null : null;
    } else nextCurrentHook = currentHook.next;
    var nextWorkInProgressHook: RR.Hook | null =
      null === workInProgressHook
        ? currentlyRenderingFiber!.memoizedState as RR.Hook | null
        : workInProgressHook.next;
    if (null !== nextWorkInProgressHook)
      (workInProgressHook = nextWorkInProgressHook),
        (currentHook = nextCurrentHook);
    else {
      if (null === nextCurrentHook) {
        if (null === currentlyRenderingFiber!.alternate)
          throw Error(formatProdErrorMessage(467));
        throw Error(formatProdErrorMessage(310));
      }
      currentHook = nextCurrentHook;
      nextCurrentHook = {
        memoizedState: currentHook.memoizedState,
        baseState: currentHook.baseState,
        baseQueue: currentHook.baseQueue,
        queue: currentHook.queue,
        next: null
      };
      null === workInProgressHook
        ? (currentlyRenderingFiber!.memoizedState = workInProgressHook =
            nextCurrentHook)
        : (workInProgressHook = workInProgressHook.next = nextCurrentHook);
    }
    return workInProgressHook;
  }
  function createFunctionComponentUpdateQueue(): RR.FunctionComponentUpdateQueue {
    return { lastEffect: null, events: null, stores: null, memoCache: null };
  }
  function useThenable(thenable: RR.Thenable | RR.UsedValue): RR.UsedValue {
    var index: number | RR.Fiber | null = thenableIndexCounter;
    thenableIndexCounter += 1;
    null === thenableState && (thenableState = []);
    thenable = trackUsedThenable(thenableState, (thenable as RR.Thenable), index);
    index = currentlyRenderingFiber;
    null ===
      (null === workInProgressHook
        ? index!.memoizedState
        : workInProgressHook.next) &&
      ((index = index!.alternate),
      (ReactSharedInternals.H =
        null === index || null === index.memoizedState
          ? HooksDispatcherOnMount
          : HooksDispatcherOnUpdate));
    return thenable;
  }
  function use(usable: RR.UsableGiven): RR.UsedValue {
    if (null !== usable && "object" === typeof usable) {
      if ("function" === typeof usable.then) return useThenable(usable as RR.UsableThenable);
      if (usable.$$typeof === REACT_CONTEXT_TYPE) return readContext(usable as RR.UsableContext);
    }
    throw Error(formatProdErrorMessage(438, String(usable)));
  }
  function useMemoCache(size: number): any[] {
    var memoCache: RR.MemoCache | null = null,
      updateQueue: RR.FunctionComponentUpdateQueue | any[] | null | undefined = currentlyRenderingFiber!.updateQueue as RR.FunctionComponentUpdateQueue | null;
    null !== updateQueue && (memoCache = updateQueue.memoCache);
    if (null == memoCache) {
      var current: RR.Fiber | RR.FunctionComponentUpdateQueue | RR.MemoCache | number | null = currentlyRenderingFiber!.alternate;
      null !== current &&
        ((current = current.updateQueue as RR.FunctionComponentUpdateQueue | null),
        null !== current &&
          ((current = current.memoCache),
          null != current &&
            (memoCache = {
              data: current.data.map(function (array) {
                return array.slice();
              }),
              index: 0
            })));
    }
    null == memoCache && (memoCache = { data: [], index: 0 });
    null === updateQueue &&
      ((updateQueue = createFunctionComponentUpdateQueue()),
      (currentlyRenderingFiber!.updateQueue = updateQueue));
    updateQueue.memoCache = memoCache;
    updateQueue = memoCache.data[memoCache.index];
    if (void 0 === updateQueue)
      for (
        updateQueue = memoCache.data[memoCache.index] = Array(size),
          current = 0;
        current < size;
        current++
      )
        updateQueue[current] = REACT_MEMO_CACHE_SENTINEL;
    memoCache.index++;
    return updateQueue;
  }
  function basicStateReducer(state: RR.HookState, action: RR.HookState): RR.HookState {
    return "function" === typeof action ? action(state) : action;
  }
  function updateReducer(reducer: RR.Reducer): RR.DispatchTuple {
    var hook = updateWorkInProgressHook();
    return updateReducerImpl(hook, currentHook!, reducer);
  }
  function updateReducerImpl(hook: RR.Hook, current: RR.Hook | RR.HookUpdate, reducer: RR.Reducer | RR.EntangledActionThenable | null): RR.DispatchTuple {
    var queue = hook.queue as RR.HookQueue | null;
    if (null === queue) throw Error(formatProdErrorMessage(311));
    queue.lastRenderedReducer = (reducer as RR.Reducer);
    var baseQueue = hook.baseQueue,
      pendingQueue: RR.HookUpdate | RR.HookState | null = queue.pending;
    if (null !== (pendingQueue as RR.HookUpdate | null)) {
      if (null !== baseQueue) {
        var baseFirst: RR.HookUpdate | RR.HookState | null = baseQueue.next;
        baseQueue.next = (pendingQueue as RR.HookUpdate | null)!.next;
        (pendingQueue as RR.HookUpdate | null)!.next = (baseFirst as RR.HookUpdate | null);
      }
      (current as RR.Hook).baseQueue = baseQueue = (pendingQueue as RR.HookUpdate | null);
      queue.pending = null;
    }
    pendingQueue = hook.baseState;
    if (null === baseQueue) hook.memoizedState = pendingQueue;
    else {
      current = baseQueue.next!;
      var newBaseQueueFirst: RR.HookUpdate | null = (baseFirst = null),
        newBaseQueueLast: RR.HookUpdate | null = null as RR.HookUpdate | null,
        update: RR.HookUpdate | null = current,
        didReadFromEntangledAsyncAction$51 = !1;
      do {
        var updateLane: RR.Lane | RR.HookUpdate | RR.HookState = update.lane & -536870913;
        if (
          (updateLane as RR.Lane) !== update.lane
            ? (workInProgressRootRenderLanes & (updateLane as RR.Lane)) === (updateLane as RR.Lane)
            : (renderLanes & (updateLane as RR.Lane)) === (updateLane as RR.Lane)
        ) {
          var revertLane: RR.Lane | RR.HookUpdate = update.revertLane;
          if (0 === revertLane)
            null !== newBaseQueueLast &&
              (newBaseQueueLast = newBaseQueueLast.next =
                {
                  lane: 0,
                  revertLane: 0,
                  gesture: null,
                  action: update.action,
                  hasEagerState: update.hasEagerState,
                  eagerState: update.eagerState,
                  next: null
                }),
              (updateLane as RR.Lane) === currentEntangledLane &&
                (didReadFromEntangledAsyncAction$51 = !0);
          else if ((renderLanes & revertLane) === revertLane) {
            update = update.next;
            revertLane === currentEntangledLane &&
              (didReadFromEntangledAsyncAction$51 = !0);
            continue;
          } else
            (updateLane = {
              lane: 0,
              revertLane: update.revertLane,
              gesture: null,
              action: update.action,
              hasEagerState: update.hasEagerState,
              eagerState: update.eagerState,
              next: null
            } as RR.HookUpdate),
              null === newBaseQueueLast
                ? ((newBaseQueueFirst = newBaseQueueLast = (updateLane as RR.HookUpdate)),
                  (baseFirst = pendingQueue))
                : (newBaseQueueLast = newBaseQueueLast.next = (updateLane as RR.HookUpdate)),
              (currentlyRenderingFiber!.lanes |= revertLane),
              (workInProgressRootSkippedLanes |= revertLane);
          updateLane = update.action;
          shouldDoubleInvokeUserFnsInHooksDEV &&
            (reducer as RR.Reducer)(pendingQueue, updateLane);
          pendingQueue = update.hasEagerState
            ? update.eagerState
            : (reducer as RR.Reducer)(pendingQueue, updateLane);
        } else
          (revertLane = {
            lane: (updateLane as RR.Lane),
            revertLane: update.revertLane,
            gesture: update.gesture,
            action: update.action,
            hasEagerState: update.hasEagerState,
            eagerState: update.eagerState,
            next: null
          }),
            null === newBaseQueueLast
              ? ((newBaseQueueFirst = newBaseQueueLast = revertLane),
                (baseFirst = pendingQueue))
              : (newBaseQueueLast = newBaseQueueLast.next = revertLane),
            (currentlyRenderingFiber!.lanes |= (updateLane as RR.Lane)),
            (workInProgressRootSkippedLanes |= (updateLane as RR.Lane));
        update = update.next;
      } while (null !== update && update !== current);
      null === newBaseQueueLast
        ? (baseFirst = pendingQueue)
        : (newBaseQueueLast.next = newBaseQueueFirst);
      if (
        !objectIs(pendingQueue, hook.memoizedState) &&
        ((didReceiveUpdate = !0),
        didReadFromEntangledAsyncAction$51 &&
          ((reducer = currentEntangledActionThenable), null !== reducer))
      )
        throw reducer;
      hook.memoizedState = pendingQueue;
      hook.baseState = baseFirst;
      hook.baseQueue = newBaseQueueLast;
      queue.lastRenderedState = pendingQueue;
    }
    null === baseQueue && (queue.lanes = 0);
    return [hook.memoizedState, queue.dispatch];
  }
  function rerenderReducer(reducer: RR.Reducer): RR.DispatchTuple {
    var hook = updateWorkInProgressHook(),
      queue = hook.queue as RR.HookQueue | null;
    if (null === queue) throw Error(formatProdErrorMessage(311));
    queue.lastRenderedReducer = reducer;
    var dispatch = queue.dispatch,
      lastRenderPhaseUpdate = queue.pending,
      newState = hook.memoizedState;
    if (null !== lastRenderPhaseUpdate) {
      queue.pending = null;
      var update = (lastRenderPhaseUpdate = lastRenderPhaseUpdate.next);
      do (newState = reducer(newState, update!.action)), (update = update!.next);
      while (update !== lastRenderPhaseUpdate);
      objectIs(newState, hook.memoizedState) || (didReceiveUpdate = !0);
      hook.memoizedState = newState;
      null === hook.baseQueue && (hook.baseState = newState);
      queue.lastRenderedState = newState;
    }
    return [newState, dispatch];
  }
  function updateSyncExternalStore(subscribe: RR.StoreSubscribe, getSnapshot: RR.GetSnapshot, getServerSnapshot?: RR.GetSnapshot | RR.HookState): RR.HookState {
    var fiber = currentlyRenderingFiber!,
      hook: RR.Hook | RR.StoreInstance = updateWorkInProgressHook(),
      isHydrating$jscomp$0 = isHydrating;
    if (isHydrating$jscomp$0) {
      if (void 0 === (getServerSnapshot as RR.GetSnapshot))
        throw Error(formatProdErrorMessage(407));
      getServerSnapshot = (getServerSnapshot as RR.GetSnapshot)();
    } else getServerSnapshot = getSnapshot();
    var snapshotChanged = !objectIs(
      (currentHook || hook).memoizedState,
      getServerSnapshot
    );
    snapshotChanged &&
      ((hook.memoizedState = getServerSnapshot), (didReceiveUpdate = !0));
    hook = hook.queue as RR.StoreInstance;
    updateEffect(subscribeToStore.bind(null, fiber, hook, subscribe), [
      subscribe
    ]);
    if (
      hook.getSnapshot !== getSnapshot ||
      snapshotChanged ||
      (null !== workInProgressHook && workInProgressHook.memoizedState.tag & 1)
    ) {
      fiber.flags |= 2048;
      pushSimpleEffect(
        9,
        { destroy: void 0 },
        updateStoreInstance.bind(
          null,
          fiber,
          hook,
          getServerSnapshot,
          getSnapshot
        ),
        null
      );
      if (null === workInProgressRoot) throw Error(formatProdErrorMessage(349));
      isHydrating$jscomp$0 ||
        0 !== (renderLanes & 127) ||
        pushStoreConsistencyCheck(fiber, getSnapshot, getServerSnapshot);
    }
    return getServerSnapshot;
  }
  function pushStoreConsistencyCheck(fiber: RR.Fiber | RR.StoreConsistencyCheck, getSnapshot: RR.GetSnapshot | RR.FunctionComponentUpdateQueue | null, renderedSnapshot: RR.HookState | RR.StoreConsistencyCheck[] | null): void {
    (fiber as RR.Fiber).flags |= 16384;
    fiber = { getSnapshot: (getSnapshot as RR.GetSnapshot), value: renderedSnapshot } as RR.StoreConsistencyCheck;
    getSnapshot = currentlyRenderingFiber!.updateQueue as RR.FunctionComponentUpdateQueue | null;
    null === getSnapshot
      ? ((getSnapshot = createFunctionComponentUpdateQueue()),
        (currentlyRenderingFiber!.updateQueue = getSnapshot),
        (getSnapshot.stores = [fiber]))
      : ((renderedSnapshot = getSnapshot.stores),
        null === (renderedSnapshot as RR.StoreConsistencyCheck[] | null)
          ? (getSnapshot.stores = [fiber])
          : (renderedSnapshot as RR.StoreConsistencyCheck[] | null)!.push(fiber));
  }
  function updateStoreInstance(fiber: RR.Fiber, inst: RR.StoreInstance, nextSnapshot: RR.HookState, getSnapshot: RR.GetSnapshot): void {
    inst.value = nextSnapshot;
    inst.getSnapshot = getSnapshot;
    checkIfSnapshotChanged(inst) && forceStoreRerender(fiber);
  }
  function subscribeToStore(fiber: RR.Fiber, inst: RR.StoreInstance, subscribe: RR.StoreSubscribe): () => void {
    return subscribe(function () {
      checkIfSnapshotChanged(inst) && forceStoreRerender(fiber);
    });
  }
  function checkIfSnapshotChanged(inst: RR.StoreInstance | RR.HookState): boolean {
    var latestGetSnapshot = (inst as RR.StoreInstance).getSnapshot;
    inst = (inst as RR.StoreInstance).value;
    try {
      var nextValue = latestGetSnapshot();
      return !objectIs(inst, nextValue);
    } catch (error) {
      return !0;
    }
  }
  function forceStoreRerender(fiber: RR.Fiber): void {
    var root = enqueueConcurrentRenderForLane(fiber, 2);
    null !== root && scheduleUpdateOnFiber(root, fiber, 2);
  }
  function mountStateImpl(initialState: RR.HookState): RR.Hook {
    var hook = mountWorkInProgressHook();
    if ("function" === typeof initialState) {
      var initialStateInitializer = initialState;
      initialState = initialStateInitializer();
      if (shouldDoubleInvokeUserFnsInHooksDEV) {
        setIsStrictModeForDevtools(!0);
        try {
          initialStateInitializer();
        } finally {
          setIsStrictModeForDevtools(!1);
        }
      }
    }
    hook.memoizedState = hook.baseState = initialState;
    hook.queue = {
      pending: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: basicStateReducer,
      lastRenderedState: initialState
    } as RR.HookQueue;
    return hook;
  }
  function updateOptimisticImpl(hook: RR.Hook, current: RR.Hook | null, passthrough: RR.HookState, reducer: RR.Reducer | null | undefined): RR.DispatchTuple {
    hook.baseState = passthrough;
    return updateReducerImpl(
      hook,
      currentHook!,
      "function" === typeof reducer ? reducer : basicStateReducer
    );
  }
  function dispatchActionState(
    fiber: RR.Fiber | RR.ActionFn | null,
    actionQueue: RR.ActionStateQueue,
    setPendingState: RR.Dispatch | RR.ActionStateQueueNode | null,
    setState: RR.Dispatch,
    payload: RR.ActionPayload
  ): void {
    if (isRenderPhaseUpdate((fiber as RR.Fiber))) throw Error(formatProdErrorMessage(485));
    fiber = actionQueue.action;
    if (null !== fiber) {
      var actionNode: RR.ActionStateQueueNode = {
        payload: payload,
        action: fiber,
        next: null,
        isTransition: !0,
        status: "pending",
        value: null,
        reason: null,
        listeners: [],
        then: function (listener) {
          actionNode.listeners.push(listener);
        }
      };
      null !== ReactSharedInternals.T
        ? (setPendingState as RR.Dispatch)(!0)
        : (actionNode.isTransition = !1);
      setState(actionNode);
      setPendingState = actionQueue.pending;
      null === setPendingState
        ? ((actionNode.next = actionQueue.pending = actionNode),
          runActionStateAction(actionQueue, actionNode))
        : ((actionNode.next = setPendingState.next),
          (actionQueue.pending = setPendingState.next = actionNode));
    }
  }
  function runActionStateAction(actionQueue: RR.ActionStateQueue, node: RR.ActionStateQueueNode): void {
    var action = node.action,
      payload = node.payload,
      prevState = actionQueue.state;
    if (node.isTransition) {
      var prevTransition: RR.Transition | RR.HookState | null = ReactSharedInternals.T,
        currentTransition: RR.Transition = {};
      ReactSharedInternals.T = currentTransition;
      try {
        var returnValue = action(prevState, payload),
          onStartTransitionFinish = ReactSharedInternals.S;
        null !== onStartTransitionFinish &&
          onStartTransitionFinish(currentTransition, returnValue);
        handleActionReturnValue(actionQueue, node, returnValue);
      } catch (error) {
        onActionError(actionQueue, node, error);
      } finally {
        null !== (prevTransition as RR.Transition | null) &&
          null !== currentTransition.types &&
          ((prevTransition as RR.Transition | null)!.types = currentTransition.types),
          (ReactSharedInternals.T = (prevTransition as RR.Transition | null));
      }
    } else
      try {
        (prevTransition = action(prevState, payload)),
          handleActionReturnValue(actionQueue, node, prevTransition);
      } catch (error$55) {
        onActionError(actionQueue, node, error$55);
      }
  }
  function handleActionReturnValue(actionQueue: RR.ActionStateQueue, node: RR.ActionStateQueueNode, returnValue: RR.HookState): void {
    null !== returnValue &&
    "object" === typeof returnValue &&
    "function" === typeof returnValue.then
      ? returnValue.then(
          function (nextState: RR.HookState) {
            onActionSuccess(actionQueue, node, nextState);
          },
          function (error: RR.Thrown) {
            return onActionError(actionQueue, node, error);
          }
        )
      : onActionSuccess(actionQueue, node, returnValue);
  }
  function onActionSuccess(actionQueue: RR.ActionStateQueue, actionNode: RR.ActionStateQueueNode | null, nextState: RR.HookState | RR.ActionStateQueueNode | null): void {
    actionNode!.status = "fulfilled";
    actionNode!.value = nextState;
    notifyActionListeners((actionNode as RR.ActionStateQueueNode));
    actionQueue.state = nextState;
    actionNode = actionQueue.pending;
    null !== actionNode &&
      ((nextState = actionNode.next),
      (nextState as RR.ActionStateQueueNode | null) === actionNode
        ? (actionQueue.pending = null)
        : ((nextState = (nextState as RR.ActionStateQueueNode | null)!.next),
          (actionNode.next = (nextState as RR.ActionStateQueueNode | null)),
          runActionStateAction(actionQueue, (nextState as RR.ActionStateQueueNode | null)!)));
  }
  function onActionError(actionQueue: RR.ActionStateQueue, actionNode: RR.ActionStateQueueNode, error: RR.Thrown): void {
    var last = actionQueue.pending;
    actionQueue.pending = null;
    if (null !== last) {
      last = last.next;
      do
        (actionNode.status = "rejected"),
          (actionNode.reason = error),
          notifyActionListeners(actionNode),
          (actionNode = actionNode.next!);
      while (actionNode !== last);
    }
    actionQueue.action = null;
  }
  function notifyActionListeners(actionNode: RR.ActionStateQueueNode | RR.ActionStateQueueNode["listeners"]): void {
    actionNode = (actionNode as RR.ActionStateQueueNode).listeners;
    for (var i = 0; i < (actionNode as RR.ActionStateQueueNode["listeners"]).length; i++) (0, (actionNode as any)[i])();
  }
  function actionStateReducer<S>(oldState: S, newState: S): S {
    return newState;
  }
  function mountActionState(action: RR.ActionFn, initialStateProp: RR.HookState): RR.ActionStateTuple {
    if (isHydrating) {
      var ssrFormState: RR.ReactFormState | RR.Hook | RR.Dispatch | null = workInProgressRoot!.formState;
      if (null !== ssrFormState) {
        a: {
          var JSCompiler_inline_result: RR.Fiber | boolean | RR.HookQueue | RR.Hook | null = currentlyRenderingFiber;
          if (isHydrating) {
            if (nextHydratableInstance) {
              var markerInstance: RR.HydratableInstance | RR.ActionStateQueue | null = canHydrateFormStateMarker!(
                nextHydratableInstance,
                rootOrSingletonContext
              );
              if (markerInstance) {
                nextHydratableInstance =
                  getNextHydratableSibling!(markerInstance);
                JSCompiler_inline_result =
                  isFormStateMarkerMatching!(markerInstance);
                break a;
              }
            }
            throwOnHydrationMismatch(JSCompiler_inline_result!);
          }
          JSCompiler_inline_result = !1;
        }
        JSCompiler_inline_result && (initialStateProp = ssrFormState[0]);
      }
    }
    ssrFormState = mountWorkInProgressHook();
    ssrFormState.memoizedState = ssrFormState.baseState = initialStateProp;
    JSCompiler_inline_result = {
      pending: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: actionStateReducer,
      lastRenderedState: initialStateProp
    };
    ssrFormState.queue = JSCompiler_inline_result;
    ssrFormState = dispatchSetState.bind(
      null,
      currentlyRenderingFiber!,
      JSCompiler_inline_result
    );
    JSCompiler_inline_result.dispatch = ssrFormState;
    JSCompiler_inline_result = mountStateImpl(!1);
    var setPendingState: RR.Dispatch = dispatchOptimisticSetState.bind(
      null,
      currentlyRenderingFiber!,
      !1,
      JSCompiler_inline_result.queue as RR.HookQueue
    );
    JSCompiler_inline_result = mountWorkInProgressHook();
    markerInstance = {
      state: initialStateProp,
      dispatch: null,
      action: action,
      pending: null
    } as RR.ActionStateQueue;
    JSCompiler_inline_result.queue = markerInstance;
    ssrFormState = dispatchActionState.bind(
      null,
      currentlyRenderingFiber!,
      markerInstance,
      setPendingState,
      ssrFormState
    );
    markerInstance.dispatch = ssrFormState;
    JSCompiler_inline_result.memoizedState = action;
    return [initialStateProp, ssrFormState, !1];
  }
  function updateActionState(action: RR.ActionFn): RR.ActionStateTuple {
    var stateHook: RR.Hook = updateWorkInProgressHook();
    return updateActionStateImpl(stateHook, currentHook!, action);
  }
  function updateActionStateImpl(stateHook: RR.Hook | boolean, currentStateHook: RR.Hook | RR.HookState, action: RR.ActionFn): RR.ActionStateTuple {
    currentStateHook = updateReducerImpl(
      (stateHook as RR.Hook),
      (currentStateHook as RR.Hook),
      actionStateReducer
    )[0];
    stateHook = updateReducer(basicStateReducer)[0];
    if (
      "object" === typeof currentStateHook &&
      null !== currentStateHook &&
      "function" === typeof currentStateHook.then
    )
      try {
        var state: RR.HookState = useThenable(currentStateHook);
      } catch (x) {
        if (x === SuspenseException) throw SuspenseActionException;
        throw x;
      }
    else state = currentStateHook;
    currentStateHook = updateWorkInProgressHook();
    var actionQueue: RR.ActionStateQueue = (currentStateHook as RR.Hook).queue as RR.ActionStateQueue,
      dispatch = actionQueue.dispatch;
    action !== (currentStateHook as RR.Hook).memoizedState &&
      ((currentlyRenderingFiber!.flags |= 2048),
      pushSimpleEffect(
        9,
        { destroy: void 0 },
        actionStateActionEffect.bind(null, actionQueue, action),
        null
      ));
    return [state, dispatch, (stateHook as boolean) as boolean];
  }
  function actionStateActionEffect(actionQueue: RR.ActionStateQueue, action: RR.ActionFn): void {
    actionQueue.action = action;
  }
  function rerenderActionState<S>(action: RR.ActionFn): RR.ActionStateTuple {
    var stateHook: RR.Hook | S = updateWorkInProgressHook(),
      currentStateHook: RR.Hook | null = currentHook;
    if (null !== currentStateHook)
      return updateActionStateImpl(stateHook, currentStateHook, action);
    updateWorkInProgressHook();
    stateHook = stateHook.memoizedState;
    currentStateHook = updateWorkInProgressHook();
    var dispatch: RR.Dispatch | null = (currentStateHook.queue as RR.ActionStateQueue).dispatch;
    currentStateHook.memoizedState = action;
    return [(stateHook as S), dispatch, !1];
  }
  function pushSimpleEffect(tag: RR.HookFlags | RR.Effect, inst: RR.EffectInstance | RR.FunctionComponentUpdateQueue | null, create: RR.EffectCreate | RR.Effect | null, deps: RR.HookDeps | RR.Effect | null): RR.Effect {
    tag = { tag: (tag as RR.HookFlags), create: (create as RR.EffectCreate), deps: (deps as RR.HookDeps | null), inst: (inst as RR.EffectInstance), next: null } as RR.Effect;
    inst = currentlyRenderingFiber!.updateQueue as RR.FunctionComponentUpdateQueue | null;
    null === inst &&
      ((inst = createFunctionComponentUpdateQueue()),
      (currentlyRenderingFiber!.updateQueue = inst));
    create = inst.lastEffect;
    null === create
      ? (inst.lastEffect = tag.next = tag)
      : ((deps = create.next),
        (create.next = tag),
        (tag.next = deps),
        (inst.lastEffect = tag));
    return tag;
  }
  function updateRef(): RR.RefObject {
    return updateWorkInProgressHook().memoizedState;
  }
  function mountEffectImpl(fiberFlags: RR.Flags, hookFlags: RR.HookFlags, create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    var hook: RR.Hook = mountWorkInProgressHook();
    currentlyRenderingFiber!.flags |= fiberFlags;
    hook.memoizedState = pushSimpleEffect(
      1 | hookFlags,
      { destroy: void 0 },
      create,
      void 0 === deps ? null : deps
    );
  }
  function updateEffectImpl(fiberFlags: RR.Flags, hookFlags: RR.HookFlags, create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    var hook: RR.Hook = updateWorkInProgressHook();
    deps = void 0 === deps ? null : deps;
    var inst: RR.EffectInstance = (hook.memoizedState as RR.Effect).inst;
    null !== currentHook &&
    null !== deps &&
    areHookInputsEqual(deps, (currentHook.memoizedState as RR.Effect).deps)
      ? (hook.memoizedState = pushSimpleEffect(hookFlags, inst, create, deps))
      : ((currentlyRenderingFiber!.flags |= fiberFlags),
        (hook.memoizedState = pushSimpleEffect(
          1 | hookFlags,
          inst,
          create,
          deps
        )));
  }
  function mountEffect(create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    mountEffectImpl(8390656, 8, create, deps);
  }
  function updateEffect(create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    updateEffectImpl(2048, 8, create, deps);
  }
  function useEffectEventImpl(payload: RR.EventFunctionPayload): void {
    currentlyRenderingFiber!.flags |= 4;
    var componentUpdateQueue: RR.FunctionComponentUpdateQueue | null = currentlyRenderingFiber!.updateQueue as RR.FunctionComponentUpdateQueue | null;
    if (null === componentUpdateQueue)
      (componentUpdateQueue = createFunctionComponentUpdateQueue()),
        (currentlyRenderingFiber!.updateQueue = componentUpdateQueue),
        (componentUpdateQueue.events = [payload]);
    else {
      var events = componentUpdateQueue.events;
      null === events
        ? (componentUpdateQueue.events = [payload])
        : events.push(payload);
    }
  }
  function updateEvent(callback: RR.EventFunctionRef["impl"]): RR.EventFunctionRef["impl"] {
    var ref: RR.EventFunctionRef = updateWorkInProgressHook().memoizedState;
    useEffectEventImpl({ ref: ref, nextImpl: callback });
    return function () {
      if (0 !== (executionContext & 2))
        throw Error(formatProdErrorMessage(440));
      return ref.impl.apply(void 0, arguments as any);
    };
  }
  function updateInsertionEffect(create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    return updateEffectImpl(4, 2, create, deps);
  }
  function updateLayoutEffect(create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    return updateEffectImpl(4, 4, create, deps);
  }
  function imperativeHandleEffect<T>(create: (() => T) | T, ref: RR.Ref | undefined): void | (() => void) {
    if ("function" === typeof ref) {
      create = (create as (() => T))();
      var refCleanup = ref(create);
      return function () {
        "function" === typeof refCleanup ? refCleanup() : ref(null);
      };
    }
    if (null !== ref && void 0 !== ref)
      return (
        (create = (create as (() => T))()),
        (ref.current = create),
        function () {
          ref.current = null;
        }
      );
  }
  function updateImperativeHandle<T>(ref: RR.Ref | undefined, create: () => T, deps: RR.HookDeps | null | undefined): void {
    deps = null !== deps && void 0 !== deps ? deps.concat([ref]) : null;
    updateEffectImpl(
      4,
      4,
      imperativeHandleEffect.bind(null, create, ref),
      deps
    );
  }
  function mountDebugValue(): void {}
  function updateCallback<T>(callback: T, deps: RR.HookDeps | null | undefined): T {
    var hook: RR.Hook = updateWorkInProgressHook();
    deps = void 0 === deps ? null : deps;
    var prevState: RR.MemoizedPair<T> = hook.memoizedState;
    if (null !== deps && areHookInputsEqual(deps, prevState[1]))
      return prevState[0];
    hook.memoizedState = [callback, deps];
    return callback;
  }
  function updateMemo<T>(nextCreate: () => T, deps: RR.HookDeps | null | undefined): T {
    var hook: RR.Hook = updateWorkInProgressHook();
    deps = void 0 === deps ? null : deps;
    var prevState: RR.MemoizedPair<T> | T = hook.memoizedState as RR.MemoizedPair<T>;
    if (null !== deps && areHookInputsEqual(deps, prevState[1]))
      return prevState[0];
    prevState = nextCreate();
    if (shouldDoubleInvokeUserFnsInHooksDEV) {
      setIsStrictModeForDevtools(!0);
      try {
        nextCreate();
      } finally {
        setIsStrictModeForDevtools(!1);
      }
    }
    hook.memoizedState = [prevState, deps];
    return prevState;
  }
  function mountDeferredValueImpl<T>(hook: RR.Hook | RR.Lane, value: T, initialValue: T | undefined): T {
    if (
      void 0 === initialValue ||
      (0 !== (renderLanes & 1073741824) &&
        0 === (workInProgressRootRenderLanes & 261930))
    )
      return ((hook as RR.Hook).memoizedState = value);
    (hook as RR.Hook).memoizedState = initialValue;
    hook = requestDeferredLane();
    currentlyRenderingFiber!.lanes |= hook;
    workInProgressRootSkippedLanes |= hook;
    return initialValue;
  }
  function updateDeferredValueImpl<T>(hook: RR.Hook | T | number, prevValue: T, value: T, initialValue: T | undefined): T {
    if (objectIs(value, prevValue)) return value;
    if (null !== currentTreeHiddenStackCursor.current)
      return (
        (hook = mountDeferredValueImpl((hook as RR.Hook), value, initialValue)),
        objectIs(hook, prevValue) || (didReceiveUpdate = !0),
        hook
      );
    if (
      0 === (renderLanes & 42) ||
      (0 !== (renderLanes & 1073741824) &&
        0 === (workInProgressRootRenderLanes & 261930))
    )
      return (didReceiveUpdate = !0), ((hook as RR.Hook).memoizedState = value);
    hook = requestDeferredLane();
    currentlyRenderingFiber!.lanes |= hook;
    workInProgressRootSkippedLanes |= hook;
    return prevValue;
  }
  function startTransition(
    fiber: RR.Fiber,
    queue: RR.HookQueue,
    pendingState: RR.HookState,
    finishedState: RR.HookState,
    callback: () => unknown
  ): void {
    var previousPriority: RR.EventPriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(
      0 !== previousPriority && 8 > previousPriority ? previousPriority : 8
    );
    var prevTransition: RR.Transition | null = ReactSharedInternals.T,
      currentTransition: RR.Transition = {};
    ReactSharedInternals.T = currentTransition;
    dispatchOptimisticSetState(fiber, !1, queue, pendingState);
    try {
      var returnValue: any = callback(),
        onStartTransitionFinish: RR.SharedInternals["S"] = ReactSharedInternals.S;
      null !== onStartTransitionFinish &&
        onStartTransitionFinish(currentTransition, returnValue);
      if (
        null !== returnValue &&
        "object" === typeof returnValue &&
        "function" === typeof returnValue.then
      ) {
        var thenableForFinishedState: RR.ChainedThenable = chainThenableValue(
          returnValue,
          finishedState
        );
        dispatchSetStateInternal(
          fiber,
          queue,
          thenableForFinishedState,
          requestUpdateLane(fiber)
        );
      } else
        dispatchSetStateInternal(
          fiber,
          queue,
          finishedState,
          requestUpdateLane(fiber)
        );
    } catch (error) {
      dispatchSetStateInternal<RR.RejectedThenable>(
        fiber,
        queue,
        { then: function () {}, status: "rejected", reason: error },
        requestUpdateLane()
      );
    } finally {
      setCurrentUpdatePriority(previousPriority),
        null !== prevTransition &&
          null !== currentTransition.types &&
          (prevTransition.types = currentTransition.types),
        (ReactSharedInternals.T = prevTransition);
    }
  }
  function ensureFormComponentIsStateful(formFiber: RR.Fiber | null): RR.Hook {
    var existingStateHook: RR.Hook | null = formFiber!.memoizedState as RR.Hook | null;
    if (null !== existingStateHook) return existingStateHook;
    existingStateHook = {
      memoizedState: NotPendingTransition,
      baseState: NotPendingTransition,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: basicStateReducer,
        lastRenderedState: NotPendingTransition
      } as RR.HookQueue,
      next: null
    };
    var initialResetState: RR.FormResetState = {};
    existingStateHook.next = {
      memoizedState: initialResetState,
      baseState: initialResetState,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: basicStateReducer,
        lastRenderedState: initialResetState
      } as RR.HookQueue,
      next: null
    };
    formFiber!.memoizedState = existingStateHook;
    formFiber = formFiber!.alternate;
    null !== formFiber && (formFiber.memoizedState = existingStateHook);
    return existingStateHook;
  }
  function useHostTransitionStatus(): RR.TransitionStatus {
    return readContext(HostTransitionContext);
  }
  function updateId(): string {
    return updateWorkInProgressHook().memoizedState;
  }
  function updateRefresh(): () => void {
    return updateWorkInProgressHook().memoizedState;
  }
  function refreshCache(fiber: RR.Fiber | RR.Update): void {
    for (var provider: RR.Fiber | RR.CacheUpdatePayload | null = (fiber as RR.Fiber).return; null !== provider; ) {
      switch ((provider as RR.Fiber | null)!.tag) {
        case 24:
        case 3:
          var lane: RR.Lane = requestUpdateLane();
          fiber = createUpdate(lane);
          var root: RR.FiberRoot | null = enqueueUpdate((provider as RR.Fiber | null)!, fiber, lane);
          null !== root &&
            (scheduleUpdateOnFiber(root, (provider as RR.Fiber | null)!, lane),
            entangleTransitions(root, (provider as RR.Fiber | null), lane));
          provider = { cache: createCache() };
          fiber.payload = provider;
          return;
      }
      provider = (provider as RR.Fiber | null)!.return;
    }
  }
  function dispatchReducerAction<A>(fiber: RR.Fiber, queue: RR.HookQueue, action: A | RR.HookUpdate | RR.FiberRoot | null): void {
    var lane: RR.Lane = requestUpdateLane();
    action = {
      lane: lane,
      revertLane: 0,
      gesture: null,
      action: (action as A),
      hasEagerState: !1,
      eagerState: null,
      next: null
    } as RR.HookUpdate;
    isRenderPhaseUpdate(fiber)
      ? enqueueRenderPhaseUpdate(queue, action)
      : ((action = enqueueConcurrentHookUpdate(fiber, queue, action, lane)),
        null !== action &&
          (scheduleUpdateOnFiber(action, fiber, lane),
          entangleTransitionUpdate(action, queue, lane)));
  }
  function dispatchSetState(fiber: RR.Fiber, queue: RR.HookQueue, action: RR.HookState): void {
    var lane: RR.Lane = requestUpdateLane();
    dispatchSetStateInternal(fiber, queue, action, lane);
  }
  function dispatchSetStateInternal<A>(fiber: RR.Fiber, queue: RR.HookQueue, action: A | RR.FiberRoot | null, lane: RR.Lane): boolean {
    var update: RR.HookUpdate = {
      lane: lane,
      revertLane: 0,
      gesture: null,
      action: (action as A),
      hasEagerState: !1,
      eagerState: null,
      next: null
    };
    if (isRenderPhaseUpdate(fiber)) enqueueRenderPhaseUpdate(queue, update);
    else {
      var alternate: RR.Fiber | RR.Reducer | null = fiber.alternate;
      if (
        0 === fiber.lanes &&
        (null === alternate || 0 === alternate.lanes) &&
        ((alternate = queue.lastRenderedReducer), null !== alternate)
      )
        try {
          var currentState: RR.HookState = queue.lastRenderedState,
            eagerState: RR.HookState = alternate(currentState, (action as A));
          update.hasEagerState = !0;
          update.eagerState = eagerState;
          if (objectIs(eagerState, currentState))
            return (
              enqueueUpdate$1(fiber, queue, update, 0),
              null === workInProgressRoot && finishQueueingConcurrentUpdates(),
              !1
            );
        } catch (error) {
        } finally {
        }
      action = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
      if (null !== action)
        return (
          scheduleUpdateOnFiber(action, fiber, lane),
          entangleTransitionUpdate(action, queue, lane),
          !0
        );
    }
    return !1;
  }
  function dispatchOptimisticSetState<A>(
    fiber: RR.Fiber,
    throwIfDuringRender: boolean | RR.FiberRoot | null,
    queue: RR.HookQueue,
    action: A | RR.HookUpdate
  ): void {
    action = {
      lane: 2,
      revertLane: requestTransitionLane(),
      gesture: null,
      action: (action as A),
      hasEagerState: !1,
      eagerState: null,
      next: null
    } as RR.HookUpdate;
    if (isRenderPhaseUpdate(fiber)) {
      if ((throwIfDuringRender as boolean)) throw Error(formatProdErrorMessage(479));
    } else
      (throwIfDuringRender = enqueueConcurrentHookUpdate(
        fiber,
        queue,
        action,
        2
      )),
        null !== throwIfDuringRender &&
          scheduleUpdateOnFiber(throwIfDuringRender, fiber, 2);
  }
  function isRenderPhaseUpdate(fiber: RR.Fiber): boolean {
    var alternate = fiber.alternate;
    return (
      fiber === currentlyRenderingFiber ||
      (null !== alternate && alternate === currentlyRenderingFiber)
    );
  }
  function enqueueRenderPhaseUpdate(queue: RR.HookQueue, update: RR.HookUpdate): void {
    didScheduleRenderPhaseUpdateDuringThisPass = didScheduleRenderPhaseUpdate =
      !0;
    var pending = queue.pending;
    null === pending
      ? (update.next = update)
      : ((update.next = pending.next), (pending.next = update));
    queue.pending = update;
  }
  function entangleTransitionUpdate(root: RR.FiberRoot, queue: RR.HookQueue, lane: RR.Lanes): void {
    if (0 !== (lane & 4194048)) {
      var queueLanes = queue.lanes;
      queueLanes &= root.pendingLanes;
      lane |= queueLanes;
      queue.lanes = lane;
      markRootEntangled(root, lane);
    }
  }
  function applyDerivedStateFromProps(
    workInProgress: RR.Fiber,
    ctor: RR.ClassComponent | RR.State,
    getDerivedStateFromProps: RR.DeriveStateFromProps | RR.ClassState | RR.State | null | undefined,
    nextProps: RR.Props
  ): void {
    ctor = workInProgress.memoizedState;
    getDerivedStateFromProps = (getDerivedStateFromProps as RR.DeriveStateFromProps)(nextProps, ctor);
    getDerivedStateFromProps =
      null === getDerivedStateFromProps || void 0 === getDerivedStateFromProps
        ? ctor
        : assign({}, ctor, getDerivedStateFromProps);
    workInProgress.memoizedState = getDerivedStateFromProps;
    0 === workInProgress.lanes &&
      ((workInProgress.updateQueue as RR.UpdateQueue).baseState = getDerivedStateFromProps);
  }
  function checkShouldComponentUpdate(
    workInProgress: RR.Fiber | RR.ClassInstance,
    ctor: RR.ClassComponent,
    oldProps: RR.Props,
    newProps: RR.Props,
    oldState: RR.State,
    newState: RR.State,
    nextContext: RR.ContextValue
  ): boolean {
    workInProgress = (workInProgress as RR.Fiber).stateNode as RR.ClassInstance;
    return "function" === typeof workInProgress.shouldComponentUpdate
      ? (workInProgress as RR.ClassInstance).shouldComponentUpdate!(newProps, newState, nextContext)
      : ctor.prototype && ctor.prototype.isPureReactComponent
        ? !shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState)
        : !0;
  }
  function callComponentWillReceiveProps(
    workInProgress: RR.Fiber | RR.ClassInstance["state"],
    instance: RR.ClassInstance,
    newProps: RR.Props,
    nextContext: RR.ContextValue
  ): void {
    workInProgress = instance.state;
    "function" === typeof instance.componentWillReceiveProps &&
      instance.componentWillReceiveProps(newProps, nextContext);
    "function" === typeof instance.UNSAFE_componentWillReceiveProps &&
      instance.UNSAFE_componentWillReceiveProps(newProps, nextContext);
    instance.state !== workInProgress &&
      classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
  function resolveClassComponentProps(Component: RR.ClassComponent | RR.ClassComponent["defaultProps"], baseProps: RR.Props): RR.Props {
    var newProps: RR.Props = baseProps;
    if ("ref" in baseProps) {
      newProps = {};
      for (var propName in baseProps)
        "ref" !== propName && (newProps[propName] = baseProps[propName]);
    }
    if ((Component = (Component as RR.ClassComponent).defaultProps)) {
      newProps === baseProps && (newProps = assign({}, newProps));
      for (var propName$57 in Component)
        void 0 === newProps[propName$57] &&
          (newProps[propName$57] = (Component as RR.ClassComponent["defaultProps"])![propName$57]);
    }
    return newProps;
  }
  function logUncaughtError(root: RR.FiberRoot, errorInfo: RR.CapturedValue): void {
    try {
      var onUncaughtError = root.onUncaughtError;
      onUncaughtError(errorInfo.value, { componentStack: errorInfo.stack });
    } catch (e) {
      setTimeout(function () {
        throw e;
      });
    }
  }
  function logCaughtError(root: RR.FiberRoot, boundary: RR.Fiber, errorInfo: RR.CapturedValue): void {
    try {
      var onCaughtError = root.onCaughtError;
      onCaughtError(errorInfo.value, {
        componentStack: errorInfo.stack,
        errorBoundary: 1 === boundary.tag ? boundary.stateNode : null
      });
    } catch (e) {
      setTimeout(function () {
        throw e;
      });
    }
  }
  function createRootErrorUpdate(root: RR.FiberRoot, errorInfo: RR.CapturedValue, lane: RR.Lane | RR.Update): RR.Update {
    lane = createUpdate((lane as RR.Lane));
    lane.tag = 3;
    lane.payload = { element: null } as RR.RootUpdatePayload;
    lane.callback = function () {
      logUncaughtError(root, errorInfo);
    };
    return lane;
  }
  function createClassErrorUpdate(lane: RR.Lane | RR.Update): RR.Update {
    lane = createUpdate((lane as RR.Lane));
    lane.tag = 3;
    return lane;
  }
  function initializeClassErrorUpdate(update: RR.Update, root: RR.FiberRoot, fiber: RR.Fiber, errorInfo: RR.CapturedValue): void {
    var getDerivedStateFromError = (fiber.type as RR.ClassComponent).getDerivedStateFromError;
    if ("function" === typeof getDerivedStateFromError) {
      var error = errorInfo.value;
      update.payload = function () {
        return getDerivedStateFromError!(error);
      };
      update.callback = function () {
        logCaughtError(root, fiber, errorInfo);
      };
    }
    var inst: RR.ClassInstance | null = fiber.stateNode as RR.ClassInstance | null;
    null !== inst &&
      "function" === typeof inst.componentDidCatch &&
      (update.callback = function (this: RR.ClassInstance) {
        logCaughtError(root, fiber, errorInfo);
        "function" !== typeof getDerivedStateFromError &&
          (null === legacyErrorBoundariesThatAlreadyFailed
            ? (legacyErrorBoundariesThatAlreadyFailed = new Set([this]))
            : legacyErrorBoundariesThatAlreadyFailed.add(this));
        var stack = errorInfo.stack;
        this.componentDidCatch!(errorInfo.value, {
          componentStack: null !== stack ? stack : ""
        });
      });
  }
  function throwException(
    root: RR.FiberRoot | Error | RR.Fiber | RR.Lane | RR.Update,
    returnFiber: RR.Fiber | RR.RetryQueue | RR.OffscreenQueue | Error | RR.ClassComponent | null,
    sourceFiber: RR.Fiber | RR.RetryQueue | null,
    value: RR.Thrown | RR.CapturedValue,
    rootRenderLanes: RR.Lanes | RR.Update | any
  ): boolean {
    (sourceFiber as RR.Fiber).flags |= 32768;
    if (
      null !== value &&
      "object" === typeof value &&
      "function" === typeof value.then
    ) {
      returnFiber = (sourceFiber as RR.Fiber).alternate;
      null !== returnFiber &&
        propagateParentContextChanges(
          (returnFiber as RR.Fiber | null),
          (sourceFiber as RR.Fiber),
          (rootRenderLanes as RR.Lanes),
          !0
        );
      sourceFiber = suspenseHandlerStackCursor.current;
      if (null !== sourceFiber) {
        switch (sourceFiber.tag) {
          case 31:
          case 13:
            return (
              null === shellBoundary
                ? renderDidSuspendDelayIfPossible()
                : null === sourceFiber.alternate &&
                  0 === workInProgressRootExitStatus &&
                  (workInProgressRootExitStatus = 3),
              (sourceFiber.flags &= -257),
              (sourceFiber.flags |= 65536),
              (sourceFiber.lanes = (rootRenderLanes as RR.Lanes)),
              value === noopSuspenseyCommitThenable
                ? (sourceFiber.flags |= 16384)
                : ((returnFiber = sourceFiber.updateQueue as RR.RetryQueue | null),
                  null === returnFiber
                    ? (sourceFiber.updateQueue = new Set([value]))
                    : returnFiber.add(value),
                  attachPingListener((root as RR.FiberRoot), value, (rootRenderLanes as RR.Lanes))),
              !1
            );
          case 22:
            return (
              (sourceFiber.flags |= 65536),
              value === noopSuspenseyCommitThenable
                ? (sourceFiber.flags |= 16384)
                : ((returnFiber = sourceFiber.updateQueue as RR.OffscreenQueue | null),
                  null === returnFiber
                    ? ((returnFiber = {
                        transitions: null,
                        markerInstances: null,
                        retryQueue: new Set([value])
                      } as RR.OffscreenQueue),
                      (sourceFiber.updateQueue = returnFiber))
                    : ((sourceFiber = returnFiber.retryQueue),
                      null === sourceFiber
                        ? (returnFiber.retryQueue = new Set([value]))
                        : sourceFiber.add(value)),
                  attachPingListener((root as RR.FiberRoot), value, (rootRenderLanes as RR.Lanes))),
              !1
            );
        }
        throw Error(formatProdErrorMessage(435, sourceFiber.tag));
      }
      attachPingListener((root as RR.FiberRoot), value, (rootRenderLanes as RR.Lanes));
      renderDidSuspendDelayIfPossible();
      return !1;
    }
    if (isHydrating)
      return (
        (returnFiber = suspenseHandlerStackCursor.current),
        null !== returnFiber
          ? (0 === (returnFiber.flags & 65536) && (returnFiber.flags |= 256),
            (returnFiber.flags |= 65536),
            (returnFiber.lanes = (rootRenderLanes as RR.Lanes)),
            value !== HydrationMismatchException &&
              ((root = Error(formatProdErrorMessage(422), { cause: value })),
              queueHydrationError(
                createCapturedValueAtFiber(root, (sourceFiber as RR.Fiber))
              )))
          : (value !== HydrationMismatchException &&
              ((returnFiber = Error(formatProdErrorMessage(423), {
                cause: value
              })),
              queueHydrationError(
                createCapturedValueAtFiber(returnFiber, (sourceFiber as RR.Fiber))
              )),
            (root = (root as RR.FiberRoot).current!.alternate!),
            ((root as RR.Fiber).flags |= 65536),
            (rootRenderLanes &= -(rootRenderLanes as RR.Lanes)),
            ((root as RR.Fiber).lanes |= (rootRenderLanes as RR.Lanes)),
            (value = createCapturedValueAtFiber(value, (sourceFiber as RR.Fiber))),
            (rootRenderLanes = createRootErrorUpdate(
              (root as RR.Fiber).stateNode as RR.FiberRoot,
              (value as RR.CapturedValue),
              (rootRenderLanes as RR.Lanes)
            )),
            enqueueCapturedUpdate((root as RR.Fiber), (rootRenderLanes as RR.Update)),
            4 !== workInProgressRootExitStatus &&
              (workInProgressRootExitStatus = 2)),
        !1
      );
    var wrapperError: Error | RR.CapturedValue | RR.ClassInstance | null = Error(formatProdErrorMessage(520), { cause: value });
    wrapperError = createCapturedValueAtFiber(wrapperError, (sourceFiber as RR.Fiber));
    null === workInProgressRootConcurrentErrors
      ? (workInProgressRootConcurrentErrors = [wrapperError])
      : workInProgressRootConcurrentErrors.push(wrapperError);
    4 !== workInProgressRootExitStatus && (workInProgressRootExitStatus = 2);
    if (null === (returnFiber as RR.Fiber | null)) return !0;
    value = createCapturedValueAtFiber(value, (sourceFiber as RR.Fiber));
    sourceFiber = (returnFiber as RR.Fiber | null);
    do {
      switch ((sourceFiber as RR.Fiber | null)!.tag) {
        case 3:
          return (
            ((sourceFiber as RR.Fiber | null)!.flags |= 65536),
            (root = (rootRenderLanes as RR.Lanes) & -(rootRenderLanes as RR.Lanes)),
            ((sourceFiber as RR.Fiber | null)!.lanes |= root),
            (root = createRootErrorUpdate((sourceFiber as RR.Fiber | null)!.stateNode as RR.FiberRoot, (value as RR.CapturedValue), root)),
            enqueueCapturedUpdate((sourceFiber as RR.Fiber | null), root),
            !1
          );
        case 1:
          if (
            ((returnFiber = (sourceFiber as RR.Fiber | null)!.type as RR.ClassComponent),
            (wrapperError = (sourceFiber as RR.Fiber | null)!.stateNode as RR.ClassInstance | null),
            0 === ((sourceFiber as RR.Fiber | null)!.flags & 128) &&
              ("function" === typeof returnFiber.getDerivedStateFromError ||
                (null !== wrapperError &&
                  "function" === typeof wrapperError.componentDidCatch &&
                  (null === legacyErrorBoundariesThatAlreadyFailed ||
                    !legacyErrorBoundariesThatAlreadyFailed.has(
                      wrapperError
                    )))))
          )
            return (
              ((sourceFiber as RR.Fiber | null)!.flags |= 65536),
              (rootRenderLanes &= -(rootRenderLanes as RR.Lanes)),
              ((sourceFiber as RR.Fiber | null)!.lanes |= (rootRenderLanes as RR.Lanes)),
              (rootRenderLanes = createClassErrorUpdate((rootRenderLanes as RR.Lanes))),
              initializeClassErrorUpdate(
                (rootRenderLanes as RR.Update),
                (root as RR.FiberRoot),
                (sourceFiber as RR.Fiber | null)!,
                (value as RR.CapturedValue)
              ),
              enqueueCapturedUpdate((sourceFiber as RR.Fiber | null), (rootRenderLanes as RR.Update)),
              !1
            );
      }
      sourceFiber = (sourceFiber as RR.Fiber | null)!.return;
    } while (null !== sourceFiber);
    return !1;
  }
  function reconcileChildren(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    nextChildren: RR.ReactNode,
    renderLanes: RR.Lanes
  ): void {
    workInProgress.child =
      null === current
        ? mountChildFibers(workInProgress, null, nextChildren, renderLanes)
        : reconcileChildFibers(
            workInProgress,
            current.child,
            nextChildren,
            renderLanes
          );
  }
  function updateForwardRef(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.ForwardRefType | RR.FunctionComponent,
    nextProps: RR.PropsWithRef | RR.ReactNode,
    renderLanes: RR.Lanes
  ): RR.Fiber | null {
    Component = (Component as RR.ForwardRefType).render;
    var ref = workInProgress.ref;
    if ("ref" in (nextProps as RR.PropsWithRef)) {
      var propsWithoutRef: RR.Props = {};
      for (var key in (nextProps as RR.PropsWithRef))
        "ref" !== key && (propsWithoutRef[key] = (nextProps as RR.PropsWithRef)[key]);
    } else propsWithoutRef = (nextProps as RR.PropsWithRef);
    prepareToReadContext(workInProgress);
    nextProps = renderWithHooks(
      current,
      workInProgress,
      (Component as RR.FunctionComponent),
      propsWithoutRef,
      ref,
      renderLanes
    );
    key = checkDidRenderIdHook() as any;
    if (null !== current && !didReceiveUpdate)
      return (
        bailoutHooks(current, workInProgress, renderLanes),
        bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
      );
    isHydrating && key && pushMaterializedTreeId(workInProgress);
    workInProgress.flags |= 1;
    reconcileChildren(current, workInProgress, nextProps, renderLanes);
    return workInProgress.child;
  }
  function updateMemoComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.MemoType | RR.MemoCompare | null,
    nextProps: RR.Props,
    renderLanes: RR.Lanes
  ): RR.Fiber | null {
    if (null === current) {
      var type: RR.ElementType | RR.Fiber = (Component as RR.MemoType).type;
      if (
        "function" === typeof type &&
        !shouldConstruct(type) &&
        void 0 === type.defaultProps &&
        null === (Component as RR.MemoType).compare
      )
        return (
          (workInProgress.tag = 15),
          (workInProgress.type = type),
          updateSimpleMemoComponent(
            current,
            workInProgress,
            type as RR.FunctionComponent,
            nextProps,
            renderLanes
          )
        );
      current = createFiberFromTypeAndProps(
        (Component as RR.MemoType).type,
        null,
        nextProps,
        workInProgress,
        workInProgress.mode,
        renderLanes
      );
      current.ref = workInProgress.ref;
      current.return = workInProgress;
      return (workInProgress.child = current);
    }
    type = current.child!;
    if (!checkScheduledUpdateOrContext(current, renderLanes)) {
      var prevProps = type.memoizedProps;
      Component = (Component as RR.MemoType).compare;
      Component = null !== Component ? Component : shallowEqual;
      if ((Component as RR.MemoCompare)(prevProps, nextProps) && current.ref === workInProgress.ref)
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderLanes
        );
    }
    workInProgress.flags |= 1;
    current = createWorkInProgress(type, nextProps);
    current.ref = workInProgress.ref;
    current.return = workInProgress;
    return (workInProgress.child = current);
  }
  function updateSimpleMemoComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.FunctionComponent,
    nextProps: RR.Props,
    renderLanes: RR.Lanes
  ): RR.Fiber | null {
    if (null !== current) {
      var prevProps = current.memoizedProps;
      if (
        shallowEqual(prevProps, nextProps) &&
        current.ref === workInProgress.ref
      )
        if (
          ((didReceiveUpdate = !1),
          (workInProgress.pendingProps = nextProps = prevProps),
          checkScheduledUpdateOrContext(current, renderLanes))
        )
          0 !== (current.flags & 131072) && (didReceiveUpdate = !0);
        else
          return (
            (workInProgress.lanes = current.lanes),
            bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
          );
    }
    return updateFunctionComponent(
      current,
      workInProgress,
      Component,
      nextProps,
      renderLanes
    );
  }
  function updateOffscreenComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    renderLanes: RR.Lanes,
    nextProps: RR.OffscreenProps | RR.Fiber | RR.Lanes | null
  ): RR.Fiber | null {
    var nextChildren: RR.Carried | RR.Lanes = (nextProps as RR.OffscreenProps).children,
      prevState: RR.OffscreenState | RR.Lanes | null = null !== current ? current.memoizedState as RR.OffscreenState | null : null;
    null === current &&
      null === workInProgress.stateNode &&
      (workInProgress.stateNode = {
        _visibility: 1,
        _pendingMarkers: null,
        _retryCache: null,
        _transitions: null
      } as RR.OffscreenInstance);
    if ("hidden" === (nextProps as RR.OffscreenProps).mode) {
      if (0 !== (workInProgress.flags & 128)) {
        prevState =
          null !== prevState ? prevState.baseLanes | renderLanes : renderLanes;
        if (null !== current) {
          nextProps = workInProgress.child = current.child;
          for (nextChildren = 0; null !== nextProps; )
            (nextChildren =
              nextChildren | nextProps.lanes | nextProps.childLanes),
              (nextProps = ((nextProps.sibling as RR.Fiber | null | RR.Lanes) as RR.Fiber | null));
          nextProps = nextChildren & ~prevState;
        } else (nextProps = 0), (workInProgress.child = null);
        return deferHiddenOffscreenComponent(
          current,
          workInProgress,
          prevState,
          renderLanes,
          nextProps
        );
      }
      if (0 !== (renderLanes & 536870912))
        (workInProgress.memoizedState = { baseLanes: 0, cachePool: null } as RR.OffscreenState),
          null !== current &&
            pushTransition(
              workInProgress,
              null !== prevState ? prevState.cachePool : null
            ),
          null !== prevState
            ? pushHiddenContext(workInProgress, prevState)
            : reuseHiddenContextOnStack(),
          pushOffscreenSuspenseHandler(workInProgress);
      else
        return (
          (nextProps = workInProgress.lanes = 536870912),
          deferHiddenOffscreenComponent(
            current,
            workInProgress,
            null !== prevState
              ? prevState.baseLanes | renderLanes
              : renderLanes,
            renderLanes,
            nextProps
          )
        );
    } else
      null !== prevState
        ? (pushTransition(workInProgress, prevState.cachePool),
          pushHiddenContext(workInProgress, prevState),
          reuseSuspenseHandlerOnStack(workInProgress),
          (workInProgress.memoizedState = null))
        : (null !== current && pushTransition(workInProgress, null),
          reuseHiddenContextOnStack(),
          reuseSuspenseHandlerOnStack(workInProgress));
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
    return workInProgress.child;
  }
  function bailoutOffscreenComponent(current: RR.Fiber | null, workInProgress: RR.Fiber): RR.Fiber | null {
    (null !== current && 22 === current.tag) ||
      null !== workInProgress.stateNode ||
      (workInProgress.stateNode = {
        _visibility: 1,
        _pendingMarkers: null,
        _retryCache: null,
        _transitions: null
      } as RR.OffscreenInstance);
    return workInProgress.sibling;
  }
  function deferHiddenOffscreenComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    nextBaseLanes: RR.Lanes,
    renderLanes: RR.Lanes,
    remainingChildLanes: RR.Lanes
  ): null {
    var JSCompiler_inline_result: RR.Cache | RR.SpawnedCachePool | null = peekCacheFromPool();
    JSCompiler_inline_result =
      null === JSCompiler_inline_result
        ? null
        : {
            parent: isPrimaryRenderer
              ? CacheContext._currentValue
              : CacheContext._currentValue2,
            pool: JSCompiler_inline_result
          };
    workInProgress.memoizedState = {
      baseLanes: nextBaseLanes,
      cachePool: JSCompiler_inline_result
    } as RR.OffscreenState;
    null !== current && pushTransition(workInProgress, null);
    reuseHiddenContextOnStack();
    pushOffscreenSuspenseHandler(workInProgress);
    null !== current &&
      propagateParentContextChanges(current, workInProgress, renderLanes, !0);
    workInProgress.childLanes = remainingChildLanes;
    return null;
  }
  function mountActivityChildren(workInProgress: RR.Fiber, nextProps: RR.Props | RR.Fiber): RR.Fiber {
    nextProps = mountWorkInProgressOffscreenFiber(
      { mode: (nextProps as RR.Props).mode, children: (nextProps as RR.Props).children },
      workInProgress.mode
    );
    nextProps.ref = workInProgress.ref;
    workInProgress.child = nextProps;
    nextProps.return = workInProgress;
    return nextProps;
  }
  function retryActivityComponentWithoutHydrating(
    current: RR.Fiber,
    workInProgress: RR.Fiber,
    renderLanes: RR.Lanes
  ): RR.Fiber {
    reconcileChildFibers(workInProgress, current.child, null, renderLanes);
    current = mountActivityChildren(
      workInProgress,
      workInProgress.pendingProps
    );
    current.flags |= 2;
    popSuspenseHandler(workInProgress);
    workInProgress.memoizedState = null;
    return current;
  }
  function updateActivityComponent(current: RR.Fiber | RR.HydratableInstance | RR.ActivityInstance | RR.TreeContext | null, workInProgress: RR.Fiber | null, renderLanes: RR.Lanes | RR.Fiber): RR.Fiber | null {
    var nextProps: RR.Props | RR.FiberRoot | null = workInProgress!.pendingProps as RR.Props,
      didSuspend = 0 !== (workInProgress!.flags & 128);
    workInProgress!.flags &= -129;
    if (null === (current as RR.Fiber | null)) {
      if (isHydrating) {
        if ("hidden" === nextProps.mode)
          return (
            (current = mountActivityChildren((workInProgress as RR.Fiber), nextProps)),
            (workInProgress!.lanes = 536870912),
            bailoutOffscreenComponent(null, current)
          );
        pushDehydratedActivitySuspenseHandler((workInProgress as RR.Fiber));
        (current = nextHydratableInstance)
          ? ((current = canHydrateActivityInstance!(
              current,
              rootOrSingletonContext
            )),
            null !== current &&
              ((workInProgress!.memoizedState = {
                dehydrated: current,
                treeContext:
                  null !== treeContextProvider
                    ? { id: treeContextId, overflow: treeContextOverflow }
                    : null,
                retryLane: 536870912,
                hydrationErrors: null
              } as RR.SuspenseState),
              (renderLanes = createFiberFromDehydratedFragment(current)),
              (renderLanes.return = workInProgress!),
              (workInProgress!.child = renderLanes),
              (hydrationParentFiber = workInProgress!),
              (nextHydratableInstance = null)))
          : (current = null);
        if (null === current) throw throwOnHydrationMismatch((workInProgress as RR.Fiber));
        workInProgress!.lanes = 536870912;
        return null;
      }
      return mountActivityChildren((workInProgress as RR.Fiber), nextProps);
    }
    var prevState: RR.ActivityState | null = (current as RR.Fiber | null)!.memoizedState as RR.ActivityState | null;
    if (null !== prevState) {
      var dehydrated: RR.ActivityInstance | RR.Lane | null = prevState.dehydrated;
      pushDehydratedActivitySuspenseHandler((workInProgress as RR.Fiber));
      if (didSuspend)
        if (workInProgress!.flags & 256)
          (workInProgress!.flags &= -257),
            (workInProgress = retryActivityComponentWithoutHydrating(
              (current as RR.Fiber | null)!,
              (workInProgress as RR.Fiber),
              (renderLanes as RR.Lanes)
            ));
        else if (null !== workInProgress!.memoizedState)
          (workInProgress!.child = (current as RR.Fiber | null)!.child),
            (workInProgress!.flags |= 128),
            (workInProgress = null);
        else throw Error(formatProdErrorMessage(558));
      else if (
        (didReceiveUpdate ||
          propagateParentContextChanges(
            (current as RR.Fiber | null),
            (workInProgress as RR.Fiber),
            (renderLanes as RR.Lanes),
            !1
          ),
        (didSuspend = 0 !== ((renderLanes as RR.Lanes) & (current as RR.Fiber | null)!.childLanes)),
        didReceiveUpdate || didSuspend)
      ) {
        nextProps = workInProgressRoot;
        if (
          null !== nextProps &&
          ((dehydrated = getBumpedLaneForHydration(nextProps, (renderLanes as RR.Lanes))),
          0 !== dehydrated && dehydrated !== prevState.retryLane)
        )
          throw (
            ((prevState.retryLane = dehydrated),
            enqueueConcurrentRenderForLane((current as RR.Fiber | null)!, dehydrated),
            scheduleUpdateOnFiber(nextProps, (current as RR.Fiber | null)!, dehydrated),
            SelectiveHydrationException)
          );
        renderDidSuspendDelayIfPossible();
        workInProgress = retryActivityComponentWithoutHydrating(
          (current as RR.Fiber | null)!,
          (workInProgress as RR.Fiber),
          (renderLanes as RR.Lanes)
        );
      } else
        (current = prevState.treeContext),
          supportsHydration &&
            ((nextHydratableInstance =
              getFirstHydratableChildWithinActivityInstance!(dehydrated)),
            (hydrationParentFiber = workInProgress!),
            (isHydrating = !0),
            (hydrationErrors = null),
            (rootOrSingletonContext = !1),
            null !== current &&
              restoreSuspendedTreeContext((workInProgress as RR.Fiber), current)),
          (workInProgress = mountActivityChildren((workInProgress as RR.Fiber), nextProps)),
          (workInProgress.flags |= 4096);
      return workInProgress;
    }
    current = createWorkInProgress((current as RR.Fiber | null)!.child!, {
      mode: nextProps.mode,
      children: nextProps.children
    } as RR.OffscreenProps);
    current.ref = workInProgress!.ref;
    workInProgress!.child = current;
    current.return = workInProgress!;
    return current;
  }
  function markRef(current: RR.Fiber | null, workInProgress: RR.Fiber): void {
    var ref = workInProgress.ref;
    if (null === ref)
      null !== current &&
        null !== current.ref &&
        (workInProgress.flags |= 4194816);
    else {
      if ("function" !== typeof ref && "object" !== typeof ref)
        throw Error(formatProdErrorMessage(284));
      if (null === current || current.ref !== ref)
        workInProgress.flags |= 4194816;
    }
  }
  function updateFunctionComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.FunctionComponent | RR.ReactNode,
    nextProps: RR.Props | boolean,
    renderLanes: RR.Lanes
  ): RR.Fiber | null {
    prepareToReadContext(workInProgress);
    Component = renderWithHooks(
      current,
      workInProgress,
      (Component as RR.FunctionComponent),
      (nextProps as RR.Props),
      void 0,
      renderLanes
    );
    nextProps = checkDidRenderIdHook();
    if (null !== current && !didReceiveUpdate)
      return (
        bailoutHooks(current, workInProgress, renderLanes),
        bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
      );
    isHydrating && nextProps && pushMaterializedTreeId(workInProgress);
    workInProgress.flags |= 1;
    reconcileChildren(current, workInProgress, Component, renderLanes);
    return workInProgress.child;
  }
  function replayFunctionComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    nextProps: RR.Props | RR.ReactNode,
    Component: RR.FunctionComponent | boolean,
    secondArg: RR.Ref | undefined,
    renderLanes: RR.Lanes
  ): RR.Fiber | null {
    prepareToReadContext(workInProgress);
    workInProgress.updateQueue = null;
    nextProps = renderWithHooksAgain(
      workInProgress,
      (Component as RR.FunctionComponent),
      (nextProps as RR.Props),
      secondArg
    );
    finishRenderingHooks(current);
    Component = checkDidRenderIdHook();
    if (null !== current && !didReceiveUpdate)
      return (
        bailoutHooks(current, workInProgress, renderLanes),
        bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
      );
    isHydrating && Component && pushMaterializedTreeId(workInProgress);
    workInProgress.flags |= 1;
    reconcileChildren(current, workInProgress, nextProps, renderLanes);
    return workInProgress.child;
  }
  function updateClassComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.ClassComponent | RR.ReactNode,
    nextProps: RR.Props | boolean,
    renderLanes: RR.Lanes
  ): RR.Fiber | null {
    prepareToReadContext(workInProgress);
    if (null === workInProgress.stateNode) {
      var context: RR.LegacyContext | RR.Carried | RR.ClassInstance | boolean = emptyContextObject,
        contextType: RR.ReactContext | RR.GetDerivedStateFromProps | RR.Carried | RR.LegacyContext | RR.Props | null | undefined = (Component as RR.ClassComponent).contextType;
      "object" === typeof contextType &&
        null !== contextType &&
        (context = readContext(contextType));
      context = new (Component as RR.ClassComponent)((nextProps as RR.Props), (context as RR.LegacyContext | RR.Carried));
      workInProgress.memoizedState =
        null !== context.state && void 0 !== context.state
          ? context.state
          : null;
      context.updater = classComponentUpdater;
      workInProgress.stateNode = context;
      context._reactInternals = workInProgress;
      context = workInProgress.stateNode;
      context.props = (nextProps as RR.Props);
      context.state = workInProgress.memoizedState;
      context.refs = {};
      initializeUpdateQueue(workInProgress);
      contextType = (Component as RR.ClassComponent).contextType;
      context.context =
        "object" === typeof contextType && null !== contextType
          ? readContext(contextType)
          : emptyContextObject;
      context.state = workInProgress.memoizedState;
      contextType = (Component as RR.ClassComponent).getDerivedStateFromProps;
      "function" === typeof contextType &&
        (applyDerivedStateFromProps(
          workInProgress,
          (Component as RR.ClassComponent),
          contextType,
          (nextProps as RR.Props)
        ),
        (context.state = workInProgress.memoizedState));
      "function" === typeof (Component as RR.ClassComponent).getDerivedStateFromProps ||
        "function" === typeof context.getSnapshotBeforeUpdate ||
        ("function" !== typeof context.UNSAFE_componentWillMount &&
          "function" !== typeof context.componentWillMount) ||
        ((contextType = context.state),
        "function" === typeof context.componentWillMount &&
          (context as RR.ClassInstance).componentWillMount!(),
        "function" === typeof context.UNSAFE_componentWillMount &&
          (context as RR.ClassInstance).UNSAFE_componentWillMount!(),
        (contextType as RR.Carried) !== context.state &&
          classComponentUpdater.enqueueReplaceState(
            context,
            context.state,
            null
          ),
        processUpdateQueue(workInProgress, (nextProps as RR.Props), context, renderLanes),
        suspendIfUpdateReadFromEntangledAsyncAction(),
        (context.state = workInProgress.memoizedState));
      "function" === typeof context.componentDidMount &&
        (workInProgress.flags |= 4194308);
      nextProps = !0;
    } else if (null === current) {
      context = workInProgress.stateNode as RR.ClassInstance;
      var unresolvedOldProps: RR.Props | boolean | RR.GetDerivedStateFromProps | null | undefined = workInProgress.memoizedProps as RR.Props,
        oldProps: RR.Props | boolean | RR.LegacyContext | RR.Carried = resolveClassComponentProps((Component as RR.ClassComponent), unresolvedOldProps);
      context.props = (oldProps as RR.Props);
      var oldContext: RR.Carried | RR.State | RR.ReactContext | boolean | null | undefined = context.context,
        contextType$jscomp$0: RR.ReactContext | boolean | RR.Props | null | undefined = (Component as RR.ClassComponent).contextType;
      contextType = emptyContextObject;
      "object" === typeof contextType$jscomp$0 &&
        null !== contextType$jscomp$0 &&
        (contextType = readContext(contextType$jscomp$0));
      var getDerivedStateFromProps: RR.GetDerivedStateFromProps | RR.Props | null | undefined = (Component as RR.ClassComponent).getDerivedStateFromProps;
      contextType$jscomp$0 =
        "function" === typeof getDerivedStateFromProps ||
        "function" === typeof context.getSnapshotBeforeUpdate;
      unresolvedOldProps = workInProgress.pendingProps !== unresolvedOldProps;
      contextType$jscomp$0 ||
        ("function" !== typeof context.UNSAFE_componentWillReceiveProps &&
          "function" !== typeof context.componentWillReceiveProps) ||
        ((unresolvedOldProps || (oldContext as RR.Carried) !== (contextType as RR.LegacyContext | RR.Carried)) &&
          callComponentWillReceiveProps(
            workInProgress,
            context,
            (nextProps as RR.Props),
            (contextType as RR.LegacyContext | RR.Carried)
          ));
      hasForceUpdate = !1;
      var oldState: RR.State | RR.Carried = workInProgress.memoizedState;
      context.state = oldState;
      processUpdateQueue(workInProgress, (nextProps as RR.Props), context, renderLanes);
      suspendIfUpdateReadFromEntangledAsyncAction();
      oldContext = workInProgress.memoizedState;
      unresolvedOldProps || oldState !== oldContext || hasForceUpdate
        ? ("function" === typeof getDerivedStateFromProps &&
            (applyDerivedStateFromProps(
              workInProgress,
              (Component as RR.ClassComponent),
              getDerivedStateFromProps,
              (nextProps as RR.Props)
            ),
            (oldContext = workInProgress.memoizedState)),
          (oldProps =
            hasForceUpdate ||
            checkShouldComponentUpdate(
              workInProgress,
              (Component as RR.ClassComponent),
              (oldProps as RR.Props),
              (nextProps as RR.Props),
              oldState,
              oldContext,
              (contextType as RR.LegacyContext | RR.Carried)
            ))
            ? (contextType$jscomp$0 ||
                ("function" !== typeof context.UNSAFE_componentWillMount &&
                  "function" !== typeof context.componentWillMount) ||
                ("function" === typeof context.componentWillMount &&
                  (context as RR.ClassInstance).componentWillMount!(),
                "function" === typeof context.UNSAFE_componentWillMount &&
                  (context as RR.ClassInstance).UNSAFE_componentWillMount!()),
              "function" === typeof context.componentDidMount &&
                (workInProgress.flags |= 4194308))
            : ("function" === typeof context.componentDidMount &&
                (workInProgress.flags |= 4194308),
              (workInProgress.memoizedProps = (nextProps as RR.Props)),
              (workInProgress.memoizedState = oldContext)),
          (context.props = (nextProps as RR.Props)),
          (context.state = oldContext),
          (context.context = (contextType as RR.LegacyContext | RR.Carried)),
          (nextProps = oldProps))
        : ("function" === typeof context.componentDidMount &&
            (workInProgress.flags |= 4194308),
          (nextProps = !1));
    } else {
      context = workInProgress.stateNode as RR.ClassInstance;
      cloneUpdateQueue(current, workInProgress);
      contextType = workInProgress.memoizedProps;
      contextType$jscomp$0 = resolveClassComponentProps((Component as RR.ClassComponent), (contextType as RR.Props));
      context.props = contextType$jscomp$0;
      getDerivedStateFromProps = workInProgress.pendingProps;
      oldState = context.context;
      oldContext = (Component as RR.ClassComponent).contextType;
      oldProps = emptyContextObject;
      "object" === typeof oldContext &&
        null !== oldContext &&
        (oldProps = readContext(oldContext));
      unresolvedOldProps = (Component as RR.ClassComponent).getDerivedStateFromProps;
      (oldContext =
        "function" === typeof unresolvedOldProps ||
        "function" === typeof context.getSnapshotBeforeUpdate) ||
        ("function" !== typeof context.UNSAFE_componentWillReceiveProps &&
          "function" !== typeof context.componentWillReceiveProps) ||
        (((contextType as RR.Props) !== (getDerivedStateFromProps as RR.Props) || (oldState as RR.Carried) !== oldProps) &&
          callComponentWillReceiveProps(
            workInProgress,
            context,
            (nextProps as RR.Props),
            oldProps
          ));
      hasForceUpdate = !1;
      oldState = workInProgress.memoizedState;
      context.state = oldState;
      processUpdateQueue(workInProgress, (nextProps as RR.Props), context, renderLanes);
      suspendIfUpdateReadFromEntangledAsyncAction();
      var newState = workInProgress.memoizedState;
      (contextType as RR.Props) !== (getDerivedStateFromProps as RR.Props) ||
      oldState !== newState ||
      hasForceUpdate ||
      (null !== current &&
        null !== current.dependencies &&
        checkIfContextChanged(current.dependencies))
        ? ("function" === typeof unresolvedOldProps &&
            (applyDerivedStateFromProps(
              workInProgress,
              (Component as RR.ClassComponent),
              unresolvedOldProps,
              (nextProps as RR.Props)
            ),
            (newState = workInProgress.memoizedState)),
          (contextType$jscomp$0 =
            hasForceUpdate ||
            checkShouldComponentUpdate(
              workInProgress,
              (Component as RR.ClassComponent),
              contextType$jscomp$0,
              (nextProps as RR.Props),
              oldState,
              newState,
              oldProps
            ) ||
            (null !== current &&
              null !== current.dependencies &&
              checkIfContextChanged(current.dependencies)))
            ? (oldContext ||
                ("function" !== typeof context.UNSAFE_componentWillUpdate &&
                  "function" !== typeof context.componentWillUpdate) ||
                ("function" === typeof context.componentWillUpdate &&
                  (context as RR.ClassInstance).componentWillUpdate!((nextProps as RR.Props), newState, oldProps),
                "function" === typeof context.UNSAFE_componentWillUpdate &&
                  (context as RR.ClassInstance).UNSAFE_componentWillUpdate!(
                    (nextProps as RR.Props),
                    newState,
                    oldProps
                  )),
              "function" === typeof context.componentDidUpdate &&
                (workInProgress.flags |= 4),
              "function" === typeof context.getSnapshotBeforeUpdate &&
                (workInProgress.flags |= 1024))
            : ("function" !== typeof context.componentDidUpdate ||
                ((contextType as RR.Props) === current.memoizedProps &&
                  oldState === current.memoizedState) ||
                (workInProgress.flags |= 4),
              "function" !== typeof context.getSnapshotBeforeUpdate ||
                ((contextType as RR.Props) === current.memoizedProps &&
                  oldState === current.memoizedState) ||
                (workInProgress.flags |= 1024),
              (workInProgress.memoizedProps = (nextProps as RR.Props)),
              (workInProgress.memoizedState = newState)),
          (context.props = (nextProps as RR.Props)),
          (context.state = newState),
          (context.context = oldProps),
          (nextProps = contextType$jscomp$0))
        : ("function" !== typeof context.componentDidUpdate ||
            ((contextType as RR.Props) === current.memoizedProps &&
              oldState === current.memoizedState) ||
            (workInProgress.flags |= 4),
          "function" !== typeof context.getSnapshotBeforeUpdate ||
            ((contextType as RR.Props) === current.memoizedProps &&
              oldState === current.memoizedState) ||
            (workInProgress.flags |= 1024),
          (nextProps = !1));
    }
    context = nextProps;
    markRef(current, workInProgress);
    nextProps = 0 !== (workInProgress.flags & 128);
    context || nextProps
      ? ((context = workInProgress.stateNode as RR.ClassInstance),
        (Component =
          nextProps && "function" !== typeof (Component as RR.ClassComponent).getDerivedStateFromError
            ? null
            : context.render()),
        (workInProgress.flags |= 1),
        null !== current && nextProps
          ? ((workInProgress.child = reconcileChildFibers(
              workInProgress,
              current.child,
              null,
              renderLanes
            )),
            (workInProgress.child = reconcileChildFibers(
              workInProgress,
              null,
              Component,
              renderLanes
            )))
          : reconcileChildren(current, workInProgress, Component, renderLanes),
        (workInProgress.memoizedState = context.state),
        (current = workInProgress.child))
      : (current = bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderLanes
        ));
    return current;
  }
  function mountHostRootWithoutHydrating(
    current: RR.Fiber,
    workInProgress: RR.Fiber,
    nextChildren: RR.ReactNode,
    renderLanes: RR.Lanes
  ): RR.Fiber | null {
    resetHydrationState();
    workInProgress.flags |= 256;
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
    return workInProgress.child;
  }
  function mountSuspenseOffscreenState(renderLanes: RR.Lanes): RR.OffscreenState {
    return { baseLanes: renderLanes, cachePool: getSuspendedCache() };
  }
  function getRemainingWorkInPrimaryTree(
    current: RR.Fiber | RR.Lanes | null,
    primaryTreeDidDefer: boolean,
    renderLanes: RR.Lanes
  ): RR.Lanes {
    current = null !== (current as RR.Fiber | null) ? (current as RR.Fiber | null)!.childLanes & ~renderLanes : 0;
    primaryTreeDidDefer && (current |= workInProgressDeferredLane);
    return current;
  }
  function updateSuspenseComponent(current: RR.Fiber | RR.HydratableInstance | RR.SuspenseInstance | RR.TreeContext | null, workInProgress: RR.Fiber | null, renderLanes: RR.Lanes | RR.Fiber): RR.Fiber | null {
    var nextProps: RR.SuspenseProps | RR.ReactNode | RR.Fiber | Error | RR.Lane = workInProgress!.pendingProps as RR.SuspenseProps,
      showFallback: boolean | RR.TypeOfMode | RR.SpawnedCachePool | null = !1,
      didSuspend: boolean | RR.Fiber | null = 0 !== (workInProgress!.flags & 128),
      JSCompiler_temp: boolean | string | RR.FiberRoot | RR.Fiber[] | null | undefined;
    (JSCompiler_temp = didSuspend) ||
      (JSCompiler_temp =
        null !== (current as RR.Fiber | null) && null === (current as RR.Fiber | null)!.memoizedState
          ? !1
          : 0 !== (suspenseStackCursor.current & 2));
    JSCompiler_temp && ((showFallback = !0), (workInProgress!.flags &= -129));
    JSCompiler_temp = 0 !== (workInProgress!.flags & 32);
    workInProgress!.flags &= -33;
    if (null === (current as RR.Fiber | null)) {
      if (isHydrating) {
        showFallback
          ? pushPrimaryTreeSuspenseHandler((workInProgress as RR.Fiber))
          : reuseSuspenseHandlerOnStack((workInProgress as RR.Fiber));
        (current = nextHydratableInstance)
          ? ((current = canHydrateSuspenseInstance!(
              current,
              rootOrSingletonContext
            )),
            null !== current &&
              ((workInProgress!.memoizedState = {
                dehydrated: current,
                treeContext:
                  null !== treeContextProvider
                    ? { id: treeContextId, overflow: treeContextOverflow }
                    : null,
                retryLane: 536870912,
                hydrationErrors: null
              } as RR.SuspenseState),
              (renderLanes = createFiberFromDehydratedFragment(current)),
              (renderLanes.return = workInProgress!),
              (workInProgress!.child = renderLanes),
              (hydrationParentFiber = workInProgress!),
              (nextHydratableInstance = null)))
          : (current = null);
        if (null === current) throw throwOnHydrationMismatch((workInProgress as RR.Fiber));
        isSuspenseInstanceFallback!(current)
          ? (workInProgress!.lanes = 32)
          : (workInProgress!.lanes = 536870912);
        return null;
      }
      var nextPrimaryChildren: RR.ReactNode | RR.Fiber | RR.SuspenseInstance | RR.OffscreenState | null = (nextProps as RR.SuspenseProps).children;
      nextProps = (nextProps as RR.SuspenseProps).fallback;
      if (showFallback)
        return (
          reuseSuspenseHandlerOnStack((workInProgress as RR.Fiber)),
          (showFallback = workInProgress!.mode),
          (nextPrimaryChildren = mountWorkInProgressOffscreenFiber(
            { mode: "hidden", children: nextPrimaryChildren },
            showFallback
          )),
          (nextProps = createFiberFromFragment(
            nextProps,
            showFallback,
            (renderLanes as RR.Lanes),
            null
          )),
          ((nextPrimaryChildren as RR.Fiber).return = workInProgress!),
          ((nextProps as RR.Fiber).return = workInProgress!),
          ((nextPrimaryChildren as RR.Fiber).sibling = (nextProps as RR.Fiber)),
          (workInProgress!.child = (nextPrimaryChildren as RR.Fiber)),
          (nextProps = workInProgress!.child),
          ((nextProps as RR.Fiber).memoizedState = mountSuspenseOffscreenState((renderLanes as RR.Lanes))),
          ((nextProps as RR.Fiber).childLanes = getRemainingWorkInPrimaryTree(
            (current as RR.Fiber | null),
            JSCompiler_temp,
            (renderLanes as RR.Lanes)
          )),
          (workInProgress!.memoizedState = SUSPENDED_MARKER),
          bailoutOffscreenComponent(null, (nextProps as RR.Fiber))
        );
      pushPrimaryTreeSuspenseHandler((workInProgress as RR.Fiber));
      return mountSuspensePrimaryChildren((workInProgress as RR.Fiber), nextPrimaryChildren);
    }
    var prevState: RR.SuspenseState | RR.Fiber | RR.Cache | null = (current as RR.Fiber | null)!.memoizedState as RR.SuspenseState | null;
    if (
      null !== prevState &&
      ((nextPrimaryChildren = prevState.dehydrated),
      null !== (nextPrimaryChildren as RR.SuspenseInstance | null))
    ) {
      if (didSuspend)
        workInProgress!.flags & 256
          ? (pushPrimaryTreeSuspenseHandler((workInProgress as RR.Fiber)),
            (workInProgress!.flags &= -257),
            (workInProgress = retrySuspenseComponentWithoutHydrating(
              (current as RR.Fiber | null)!,
              (workInProgress as RR.Fiber),
              (renderLanes as RR.Lanes)
            )))
          : null !== workInProgress!.memoizedState
            ? (reuseSuspenseHandlerOnStack((workInProgress as RR.Fiber)),
              (workInProgress!.child = (current as RR.Fiber | null)!.child),
              (workInProgress!.flags |= 128),
              (workInProgress = null))
            : (reuseSuspenseHandlerOnStack((workInProgress as RR.Fiber)),
              (nextPrimaryChildren = (nextProps as RR.SuspenseProps).fallback),
              (showFallback = workInProgress!.mode),
              (nextProps = mountWorkInProgressOffscreenFiber(
                { mode: "visible", children: (nextProps as RR.SuspenseProps).children },
                showFallback
              )),
              (nextPrimaryChildren = createFiberFromFragment(
                nextPrimaryChildren,
                showFallback,
                (renderLanes as RR.Lanes),
                null
              )),
              ((nextPrimaryChildren as RR.Fiber).flags |= 2),
              ((nextProps as RR.Fiber).return = workInProgress!),
              ((nextPrimaryChildren as RR.Fiber).return = workInProgress!),
              ((nextProps as RR.Fiber).sibling = (nextPrimaryChildren as RR.Fiber)),
              (workInProgress!.child = (nextProps as RR.Fiber)),
              reconcileChildFibers(
                (workInProgress as RR.Fiber),
                (current as RR.Fiber | null)!.child,
                null,
                (renderLanes as RR.Lanes)
              ),
              (nextProps = workInProgress!.child),
              ((nextProps as RR.Fiber).memoizedState =
                mountSuspenseOffscreenState((renderLanes as RR.Lanes))),
              ((nextProps as RR.Fiber).childLanes = getRemainingWorkInPrimaryTree(
                (current as RR.Fiber | null),
                JSCompiler_temp,
                (renderLanes as RR.Lanes)
              )),
              (workInProgress!.memoizedState = SUSPENDED_MARKER),
              (workInProgress = bailoutOffscreenComponent(null, (nextProps as RR.Fiber))));
      else if (
        (pushPrimaryTreeSuspenseHandler((workInProgress as RR.Fiber)),
        isSuspenseInstanceFallback!((nextPrimaryChildren as RR.SuspenseInstance | null)!))
      )
        (JSCompiler_temp =
          getSuspenseInstanceFallbackErrorDetails!((nextPrimaryChildren as RR.SuspenseInstance | null)!).digest),
          (nextProps = Error(formatProdErrorMessage(419))),
          ((nextProps as Error).stack = ""),
          (((nextProps as Error) as any).digest = JSCompiler_temp),
          queueHydrationError({ value: (nextProps as Error), source: null, stack: null }),
          (workInProgress = retrySuspenseComponentWithoutHydrating(
            (current as RR.Fiber | null)!,
            (workInProgress as RR.Fiber),
            (renderLanes as RR.Lanes)
          ));
      else if (
        (didReceiveUpdate ||
          propagateParentContextChanges(
            (current as RR.Fiber | null),
            (workInProgress as RR.Fiber),
            (renderLanes as RR.Lanes),
            !1
          ),
        (JSCompiler_temp = 0 !== ((renderLanes as RR.Lanes) & (current as RR.Fiber | null)!.childLanes)),
        didReceiveUpdate || JSCompiler_temp)
      ) {
        JSCompiler_temp = workInProgressRoot;
        if (
          null !== JSCompiler_temp &&
          ((nextProps = getBumpedLaneForHydration(
            JSCompiler_temp,
            (renderLanes as RR.Lanes)
          )),
          0 !== (nextProps as RR.Lane) && (nextProps as RR.Lane) !== prevState.retryLane)
        )
          throw (
            ((prevState.retryLane = (nextProps as RR.Lane)),
            enqueueConcurrentRenderForLane((current as RR.Fiber | null)!, (nextProps as RR.Lane)),
            scheduleUpdateOnFiber(JSCompiler_temp, (current as RR.Fiber | null)!, (nextProps as RR.Lane)),
            SelectiveHydrationException)
          );
        isSuspenseInstancePending!((nextPrimaryChildren as RR.SuspenseInstance | null)!) ||
          renderDidSuspendDelayIfPossible();
        workInProgress = retrySuspenseComponentWithoutHydrating(
          (current as RR.Fiber | null)!,
          (workInProgress as RR.Fiber),
          (renderLanes as RR.Lanes)
        );
      } else
        isSuspenseInstancePending!((nextPrimaryChildren as RR.SuspenseInstance | null)!)
          ? ((workInProgress!.flags |= 192),
            (workInProgress!.child = (current as RR.Fiber | null)!.child),
            (workInProgress = null))
          : ((current = prevState.treeContext),
            supportsHydration &&
              ((nextHydratableInstance =
                getFirstHydratableChildWithinSuspenseInstance!(
                  (nextPrimaryChildren as RR.SuspenseInstance | null)!
                )),
              (hydrationParentFiber = workInProgress!),
              (isHydrating = !0),
              (hydrationErrors = null),
              (rootOrSingletonContext = !1),
              null !== current &&
                restoreSuspendedTreeContext((workInProgress as RR.Fiber), current)),
            (workInProgress = mountSuspensePrimaryChildren(
              (workInProgress as RR.Fiber),
              (nextProps as RR.SuspenseProps).children
            )),
            (workInProgress.flags |= 4096));
      return workInProgress;
    }
    if (showFallback)
      return (
        reuseSuspenseHandlerOnStack((workInProgress as RR.Fiber)),
        (nextPrimaryChildren = (nextProps as RR.SuspenseProps).fallback),
        (showFallback = workInProgress!.mode),
        (prevState = (current as RR.Fiber | null)!.child!),
        (didSuspend = (prevState as RR.Fiber).sibling),
        (nextProps = createWorkInProgress((prevState as RR.Fiber), {
          mode: "hidden",
          children: (nextProps as RR.SuspenseProps).children
        } as RR.OffscreenProps)),
        ((nextProps as RR.Fiber).subtreeFlags = (prevState as RR.Fiber).subtreeFlags & 65011712),
        null !== didSuspend
          ? (nextPrimaryChildren = createWorkInProgress(
              (didSuspend as RR.Fiber | null)!,
              nextPrimaryChildren
            ))
          : ((nextPrimaryChildren = createFiberFromFragment(
              nextPrimaryChildren,
              showFallback,
              (renderLanes as RR.Lanes),
              null
            )),
            ((nextPrimaryChildren as RR.Fiber).flags |= 2)),
        ((nextPrimaryChildren as RR.Fiber).return = workInProgress!),
        ((nextProps as RR.Fiber).return = workInProgress!),
        ((nextProps as RR.Fiber).sibling = (nextPrimaryChildren as RR.Fiber)),
        (workInProgress!.child = (nextProps as RR.Fiber)),
        bailoutOffscreenComponent(null, (nextProps as RR.Fiber)),
        (nextProps = workInProgress!.child),
        (nextPrimaryChildren = (current as RR.Fiber | null)!.child!.memoizedState as RR.OffscreenState | null),
        null === (nextPrimaryChildren as RR.OffscreenState | null)
          ? (nextPrimaryChildren = mountSuspenseOffscreenState((renderLanes as RR.Lanes)))
          : ((showFallback = (nextPrimaryChildren as RR.OffscreenState | null)!.cachePool as RR.SpawnedCachePool | null),
            null !== showFallback
              ? ((prevState = isPrimaryRenderer
                  ? CacheContext._currentValue as RR.Cache
                  : CacheContext._currentValue2 as RR.Cache),
                (showFallback =
                  showFallback.parent !== prevState
                    ? { parent: prevState, pool: prevState } as RR.SpawnedCachePool
                    : showFallback))
              : (showFallback = getSuspendedCache()),
            (nextPrimaryChildren = {
              baseLanes: (nextPrimaryChildren as RR.OffscreenState | null)!.baseLanes | (renderLanes as RR.Lanes),
              cachePool: showFallback
            } as RR.OffscreenState)),
        ((nextProps as RR.Fiber).memoizedState = (nextPrimaryChildren as RR.OffscreenState)),
        ((nextProps as RR.Fiber).childLanes = getRemainingWorkInPrimaryTree(
          (current as RR.Fiber | null),
          JSCompiler_temp,
          (renderLanes as RR.Lanes)
        )),
        (workInProgress!.memoizedState = SUSPENDED_MARKER),
        bailoutOffscreenComponent((current as RR.Fiber | null)!.child, (nextProps as RR.Fiber))
      );
    pushPrimaryTreeSuspenseHandler((workInProgress as RR.Fiber));
    renderLanes = (((current as RR.Fiber | null)!.child! as RR.Fiber | RR.Lanes) as RR.Fiber);
    current = (renderLanes as RR.Fiber).sibling;
    renderLanes = createWorkInProgress((renderLanes as RR.Fiber), {
      mode: "visible",
      children: (nextProps as RR.SuspenseProps).children
    } as RR.OffscreenProps);
    renderLanes.return = workInProgress!;
    renderLanes.sibling = null;
    null !== current &&
      ((JSCompiler_temp = workInProgress!.deletions),
      null === JSCompiler_temp
        ? ((workInProgress!.deletions = [(current as RR.Fiber | null)!]), (workInProgress!.flags |= 16))
        : JSCompiler_temp.push((current as RR.Fiber | null)!));
    workInProgress!.child = renderLanes;
    workInProgress!.memoizedState = null;
    return renderLanes;
  }
  function mountSuspensePrimaryChildren(workInProgress: RR.Fiber, primaryChildren: RR.ReactNode | RR.Fiber): RR.Fiber {
    primaryChildren = mountWorkInProgressOffscreenFiber(
      { mode: "visible", children: primaryChildren },
      workInProgress.mode
    );
    (primaryChildren as RR.Fiber).return = workInProgress;
    return (workInProgress.child = (primaryChildren as RR.Fiber));
  }
  function mountWorkInProgressOffscreenFiber(offscreenProps: RR.OffscreenProps | RR.Fiber, mode: RR.TypeOfMode): RR.Fiber {
    offscreenProps = createFiber(22, (offscreenProps as RR.OffscreenProps), null, mode);
    offscreenProps.lanes = 0;
    return offscreenProps;
  }
  function retrySuspenseComponentWithoutHydrating(
    current: RR.Fiber,
    workInProgress: RR.Fiber,
    renderLanes: RR.Lanes
  ): RR.Fiber {
    reconcileChildFibers(workInProgress, current.child, null, renderLanes);
    current = mountSuspensePrimaryChildren(
      workInProgress,
      workInProgress.pendingProps.children
    );
    current.flags |= 2;
    workInProgress.memoizedState = null;
    return current;
  }
  function scheduleSuspenseWorkOnFiber(fiber: RR.Fiber, renderLanes: RR.Lanes, propagationRoot: RR.Fiber): void {
    fiber.lanes |= renderLanes;
    var alternate = fiber.alternate;
    null !== alternate && (alternate.lanes |= renderLanes);
    scheduleContextWorkOnParentPath(fiber.return, renderLanes, propagationRoot);
  }
  function initSuspenseListRenderState(
    workInProgress: RR.Fiber,
    isBackwards: boolean,
    tail: RR.Fiber | null,
    lastContentRow: RR.Fiber | null,
    tailMode: RR.SuspenseListTailMode,
    treeForkCount: number
  ): void {
    var renderState: RR.SuspenseListRenderState | null = workInProgress.memoizedState as RR.SuspenseListRenderState | null;
    null === renderState
      ? (workInProgress.memoizedState = {
          isBackwards: isBackwards,
          rendering: null,
          renderingStartTime: 0,
          last: lastContentRow,
          tail: tail,
          tailMode: tailMode,
          treeForkCount: treeForkCount
        } as RR.SuspenseListRenderState)
      : ((renderState.isBackwards = isBackwards),
        (renderState.rendering = null),
        (renderState.renderingStartTime = 0),
        (renderState.last = lastContentRow),
        (renderState.tail = tail),
        (renderState.tailMode = tailMode),
        (renderState.treeForkCount = treeForkCount));
  }
  function updateSuspenseListComponent(current: RR.Fiber | null, workInProgress: RR.Fiber, renderLanes: RR.Lanes | RR.Fiber | null): RR.Fiber | null {
    var nextProps: RR.SuspenseListProps | RR.ReactNode | number = workInProgress.pendingProps as RR.SuspenseListProps,
      revealOrder: unknown | RR.Fiber | null = (nextProps as RR.SuspenseListProps).revealOrder,
      tailMode = (nextProps as RR.SuspenseListProps).tail;
    nextProps = (nextProps as RR.SuspenseListProps).children;
    var suspenseContext: RR.SuspenseContext = suspenseStackCursor.current as RR.SuspenseContext,
      shouldForceFallback = 0 !== (suspenseContext & 2);
    shouldForceFallback
      ? ((suspenseContext = (suspenseContext & 1) | 2),
        (workInProgress.flags |= 128))
      : (suspenseContext &= 1);
    push(suspenseStackCursor, suspenseContext);
    reconcileChildren(current, workInProgress, nextProps, (renderLanes as RR.Lanes));
    nextProps = isHydrating ? treeForkCount : 0;
    if (!shouldForceFallback && null !== current && 0 !== (current.flags & 128))
      a: for (current = workInProgress.child; null !== current; ) {
        if (13 === current.tag)
          null !== current.memoizedState &&
            scheduleSuspenseWorkOnFiber(current, (renderLanes as RR.Lanes), workInProgress);
        else if (19 === current.tag)
          scheduleSuspenseWorkOnFiber(current, (renderLanes as RR.Lanes), workInProgress);
        else if (null !== current.child) {
          current.child.return = current;
          current = current.child;
          continue;
        }
        if (current === workInProgress) break a;
        for (; null === current.sibling; ) {
          if (null === current.return || current.return === workInProgress)
            break a;
          current = current.return;
        }
        current.sibling.return = current.return;
        current = current.sibling;
      }
    switch (revealOrder) {
      case "forwards":
        renderLanes = ((workInProgress.child as RR.Fiber | null | RR.Lanes) as RR.Fiber | null);
        for (revealOrder = null; null !== renderLanes; )
          (current = renderLanes.alternate),
            null !== current &&
              null === findFirstSuspended(current) &&
              (revealOrder = renderLanes),
            (renderLanes = ((renderLanes.sibling as RR.Fiber | null | RR.Lanes) as RR.Fiber | null));
        renderLanes = ((revealOrder as RR.Fiber | null | RR.Lanes) as RR.Fiber | null);
        null === renderLanes
          ? ((revealOrder = workInProgress.child),
            (workInProgress.child = null))
          : ((revealOrder = (renderLanes as RR.Fiber | null)!.sibling), ((renderLanes as RR.Fiber | null)!.sibling = null));
        initSuspenseListRenderState(
          workInProgress,
          !1,
          (revealOrder as RR.Fiber | null),
          renderLanes,
          tailMode,
          (nextProps as number)
        );
        break;
      case "backwards":
      case "unstable_legacy-backwards":
        renderLanes = null;
        revealOrder = workInProgress.child;
        for (workInProgress.child = null; null !== (revealOrder as RR.Fiber | null); ) {
          current = (revealOrder as RR.Fiber | null)!.alternate;
          if (null !== current && null === findFirstSuspended(current)) {
            workInProgress.child = (revealOrder as RR.Fiber | null);
            break;
          }
          current = (revealOrder as RR.Fiber | null)!.sibling;
          (revealOrder as RR.Fiber | null)!.sibling = renderLanes;
          renderLanes = (revealOrder as RR.Fiber | null);
          revealOrder = current;
        }
        initSuspenseListRenderState(
          workInProgress,
          !0,
          (renderLanes as RR.Fiber | null),
          null,
          tailMode,
          (nextProps as number)
        );
        break;
      case "together":
        initSuspenseListRenderState(
          workInProgress,
          !1,
          null,
          null,
          void 0,
          (nextProps as number)
        );
        break;
      default:
        workInProgress.memoizedState = null;
    }
    return workInProgress.child;
  }
  function bailoutOnAlreadyFinishedWork(current: RR.Fiber | null, workInProgress: RR.Fiber, renderLanes: RR.Lanes | RR.Fiber): RR.Fiber | null {
    null !== current && (workInProgress.dependencies = current.dependencies);
    workInProgressRootSkippedLanes |= workInProgress.lanes;
    if (0 === ((renderLanes as RR.Lanes) & workInProgress.childLanes))
      if (null !== current) {
        if (
          (propagateParentContextChanges(
            current,
            workInProgress,
            (renderLanes as RR.Lanes),
            !1
          ),
          0 === ((renderLanes as RR.Lanes) & workInProgress.childLanes))
        )
          return null;
      } else return null;
    if (null !== current && workInProgress.child !== current.child)
      throw Error(formatProdErrorMessage(153));
    if (null !== workInProgress.child) {
      current = workInProgress.child;
      renderLanes = createWorkInProgress(current, current.pendingProps);
      workInProgress.child = renderLanes;
      for (renderLanes.return = workInProgress; null !== current!.sibling; )
        (current = current!.sibling),
          (renderLanes = renderLanes.sibling =
            createWorkInProgress(current, current.pendingProps)),
          (renderLanes.return = workInProgress);
      renderLanes.sibling = null;
    }
    return workInProgress.child;
  }
  function checkScheduledUpdateOrContext(current: RR.Fiber | RR.Dependencies | null, renderLanes: RR.Lanes): boolean {
    if (0 !== ((current as RR.Fiber).lanes & renderLanes)) return !0;
    current = (current as RR.Fiber).dependencies;
    return null !== current && checkIfContextChanged((current as RR.Dependencies | null)) ? !0 : !1;
  }
  function attemptEarlyBailoutIfNoScheduledUpdate(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    renderLanes: RR.Lanes
  ): RR.Fiber | null {
    switch (workInProgress.tag) {
      case 3:
        pushHostContainer(
          workInProgress,
          (workInProgress.stateNode as RR.FiberRoot).containerInfo
        );
        pushProvider(workInProgress, CacheContext, (current!.memoizedState as RR.RootState).cache);
        resetHydrationState();
        break;
      case 27:
      case 5:
        pushHostContext(workInProgress);
        break;
      case 4:
        pushHostContainer(
          workInProgress,
          (workInProgress.stateNode as RR.PortalState).containerInfo
        );
        break;
      case 10:
        pushProvider(
          workInProgress,
          workInProgress.type as RR.ReactContext,
          workInProgress.memoizedProps.value
        );
        break;
      case 31:
        if (null !== workInProgress.memoizedState)
          return (
            (workInProgress.flags |= 128),
            pushDehydratedActivitySuspenseHandler(workInProgress),
            null
          );
        break;
      case 13:
        var state$82: RR.SuspenseState | boolean | null = workInProgress.memoizedState as RR.SuspenseState | null;
        if (null !== state$82) {
          if (null !== state$82.dehydrated)
            return (
              pushPrimaryTreeSuspenseHandler(workInProgress),
              (workInProgress.flags |= 128),
              null
            );
          if (0 !== (renderLanes & workInProgress.child!.childLanes))
            return updateSuspenseComponent(
              current!,
              workInProgress,
              renderLanes
            );
          pushPrimaryTreeSuspenseHandler(workInProgress);
          current = bailoutOnAlreadyFinishedWork(
            current!,
            workInProgress,
            renderLanes
          );
          return null !== current ? current.sibling : null;
        }
        pushPrimaryTreeSuspenseHandler(workInProgress);
        break;
      case 19:
        var didSuspendBefore: boolean | RR.SuspenseListRenderState | null = 0 !== (current!.flags & 128);
        state$82 = 0 !== (renderLanes & workInProgress.childLanes);
        state$82 ||
          (propagateParentContextChanges(
            current!,
            workInProgress,
            renderLanes,
            !1
          ),
          (state$82 = 0 !== (renderLanes & workInProgress.childLanes)));
        if (didSuspendBefore) {
          if (state$82)
            return updateSuspenseListComponent(
              current!,
              workInProgress,
              renderLanes
            );
          workInProgress.flags |= 128;
        }
        didSuspendBefore = workInProgress.memoizedState as RR.SuspenseListRenderState | null;
        null !== didSuspendBefore &&
          ((didSuspendBefore.rendering = null),
          (didSuspendBefore.tail = null),
          (didSuspendBefore.lastEffect = null));
        push(suspenseStackCursor, suspenseStackCursor.current);
        if (state$82) break;
        else return null;
      case 22:
        return (
          (workInProgress.lanes = 0),
          updateOffscreenComponent(
            current!,
            workInProgress,
            renderLanes,
            ((workInProgress.pendingProps as RR.OffscreenProps | RR.Lanes) as RR.OffscreenProps)
          )
        );
      case 24:
        pushProvider(workInProgress, CacheContext, (current!.memoizedState as RR.CacheComponentState).cache);
    }
    return bailoutOnAlreadyFinishedWork(current!, workInProgress, renderLanes);
  }
  function beginWork(current: RR.Fiber | RR.ResolvedLazy | RR.HydratableInstance | boolean | null, workInProgress: RR.Fiber | RR.ElementType | null, renderLanes: RR.Lanes | RR.Fiber | RR.Resource | RR.HydratableInstance | RR.TextInstance | null): RR.Fiber | null {
    if (null !== (current as RR.Fiber | null))
      if ((current as RR.Fiber | null)!.memoizedProps !== (workInProgress as RR.Fiber).pendingProps)
        didReceiveUpdate = !0;
      else {
        if (
          !checkScheduledUpdateOrContext((current as RR.Fiber | null), (renderLanes as RR.Lanes)) &&
          0 === ((workInProgress as RR.Fiber).flags & 128)
        )
          return (
            (didReceiveUpdate = !1),
            attemptEarlyBailoutIfNoScheduledUpdate(
              (current as RR.Fiber | null),
              (workInProgress as RR.Fiber),
              (renderLanes as RR.Lanes)
            )
          );
        didReceiveUpdate = 0 !== ((current as RR.Fiber | null)!.flags & 131072) ? !0 : !1;
      }
    else
      (didReceiveUpdate = !1),
        isHydrating &&
          0 !== ((workInProgress as RR.Fiber).flags & 1048576) &&
          pushTreeId((workInProgress as RR.Fiber), treeForkCount, (workInProgress as RR.Fiber).index);
    (workInProgress as RR.Fiber).lanes = 0;
    switch ((workInProgress as RR.Fiber).tag) {
      case 16:
        a: {
          var props: RR.PropsOrChildren = (workInProgress as RR.Fiber).pendingProps;
          current = resolveLazy((workInProgress as RR.Fiber).elementType) as RR.ResolvedLazy;
          (workInProgress as RR.Fiber).type = current;
          if ("function" === typeof current)
            shouldConstruct(current)
              ? ((props = resolveClassComponentProps(current as RR.ClassComponent, props)),
                ((workInProgress as RR.Fiber).tag = 1),
                (workInProgress = updateClassComponent(
                  null,
                  (workInProgress as RR.Fiber),
                  current as RR.ClassComponent,
                  props,
                  (renderLanes as RR.Lanes)
                )))
              : (((workInProgress as RR.Fiber).tag = 0),
                (workInProgress = updateFunctionComponent(
                  null,
                  (workInProgress as RR.Fiber),
                  current as RR.FunctionComponent,
                  props,
                  (renderLanes as RR.Lanes)
                )));
          else {
            if (void 0 !== current && null !== current) {
              var $$typeof: RR.Anything | RR.ElementType | RR.RootState | RR.CacheComponentState | RR.Cache | RR.FiberRoot | RR.HydratableInstance = current.$$typeof;
              if ($$typeof === REACT_FORWARD_REF_TYPE) {
                (workInProgress as RR.Fiber).tag = 11;
                workInProgress = updateForwardRef(
                  null,
                  (workInProgress as RR.Fiber),
                  current as RR.ForwardRefType,
                  props,
                  (renderLanes as RR.Lanes)
                );
                break a;
              } else if ($$typeof === REACT_MEMO_TYPE) {
                (workInProgress as RR.Fiber).tag = 14;
                workInProgress = updateMemoComponent(
                  null,
                  (workInProgress as RR.Fiber),
                  current as RR.MemoType,
                  props,
                  (renderLanes as RR.Lanes)
                );
                break a;
              }
            }
            workInProgress = getComponentNameFromType(current) || current;
            throw Error(formatProdErrorMessage(306, workInProgress, ""));
          }
        }
        return workInProgress;
      case 0:
        return updateFunctionComponent(
          (current as RR.Fiber | null),
          (workInProgress as RR.Fiber),
          (workInProgress as RR.Fiber).type as RR.FunctionComponent,
          (workInProgress as RR.Fiber).pendingProps,
          (renderLanes as RR.Lanes)
        );
      case 1:
        return (
          (props = (workInProgress as RR.Fiber).type),
          ($$typeof = resolveClassComponentProps(
            props,
            (workInProgress as RR.Fiber).pendingProps
          )),
          updateClassComponent(
            (current as RR.Fiber | null),
            (workInProgress as RR.Fiber),
            props,
            $$typeof as RR.Props,
            (renderLanes as RR.Lanes)
          )
        );
      case 3:
        a: {
          pushHostContainer(
            (workInProgress as RR.Fiber),
            ((workInProgress as RR.Fiber).stateNode as RR.FiberRoot).containerInfo
          );
          if (null === (current as RR.Fiber | null)) throw Error(formatProdErrorMessage(387));
          var nextProps: RR.PropsOrChildren | RR.Cache | RR.MemoizedState = (workInProgress as RR.Fiber).pendingProps;
          $$typeof = (workInProgress as RR.Fiber).memoizedState as RR.RootState;
          props = $$typeof.element;
          cloneUpdateQueue((current as RR.Fiber | null)!, (workInProgress as RR.Fiber));
          processUpdateQueue((workInProgress as RR.Fiber), nextProps, null, (renderLanes as RR.Lanes));
          var nextState: RR.RootState | RR.Props | null = (workInProgress as RR.Fiber).memoizedState as RR.RootState;
          nextProps = nextState.cache;
          pushProvider((workInProgress as RR.Fiber), CacheContext, (nextProps as RR.Cache));
          (nextProps as RR.Cache) !== $$typeof.cache &&
            propagateContextChanges(
              (workInProgress as RR.Fiber),
              [CacheContext],
              (renderLanes as RR.Lanes),
              !0
            );
          suspendIfUpdateReadFromEntangledAsyncAction();
          nextProps = nextState.element;
          if (supportsHydration && $$typeof.isDehydrated)
            if (
              (($$typeof = {
                element: nextProps,
                isDehydrated: !1,
                cache: nextState.cache
              } as RR.RootState),
              (((workInProgress as RR.Fiber).updateQueue as RR.UpdateQueue).baseState = $$typeof),
              ((workInProgress as RR.Fiber).memoizedState = $$typeof),
              (workInProgress as RR.Fiber).flags & 256)
            ) {
              workInProgress = mountHostRootWithoutHydrating(
                (current as RR.Fiber | null)!,
                (workInProgress as RR.Fiber),
                nextProps,
                (renderLanes as RR.Lanes)
              );
              break a;
            } else if (nextProps !== props) {
              props = createCapturedValueAtFiber(
                Error(formatProdErrorMessage(424)),
                (workInProgress as RR.Fiber)
              );
              queueHydrationError(props);
              workInProgress = mountHostRootWithoutHydrating(
                (current as RR.Fiber | null)!,
                (workInProgress as RR.Fiber),
                nextProps,
                (renderLanes as RR.Lanes)
              );
              break a;
            } else
              for (
                supportsHydration &&
                  ((nextHydratableInstance =
                    getFirstHydratableChildWithinContainer!(
                      ((workInProgress as RR.Fiber).stateNode as RR.FiberRoot).containerInfo
                    )),
                  (hydrationParentFiber = (workInProgress as RR.Fiber)),
                  (isHydrating = !0),
                  (hydrationErrors = null),
                  (rootOrSingletonContext = !0)),
                  renderLanes = mountChildFibers(
                    (workInProgress as RR.Fiber),
                    null,
                    nextProps,
                    (renderLanes as RR.Lanes)
                  ),
                  (workInProgress as RR.Fiber).child = renderLanes;
                renderLanes;

              )
                (renderLanes.flags = (renderLanes.flags & -3) | 4096),
                  (renderLanes = renderLanes.sibling);
          else {
            resetHydrationState();
            if (nextProps === props) {
              workInProgress = bailoutOnAlreadyFinishedWork(
                (current as RR.Fiber | null),
                (workInProgress as RR.Fiber),
                (renderLanes as RR.Lanes)
              );
              break a;
            }
            reconcileChildren((current as RR.Fiber | null), (workInProgress as RR.Fiber), nextProps, (renderLanes as RR.Lanes));
          }
          workInProgress = (workInProgress as RR.Fiber).child;
        }
        return (workInProgress as RR.Fiber | null);
      case 26:
        if (supportsResources)
          return (
            markRef((current as RR.Fiber | null), (workInProgress as RR.Fiber)),
            null === (current as RR.Fiber | null)
              ? (renderLanes = getResource!(
                  (workInProgress as RR.Fiber).type,
                  null,
                  (workInProgress as RR.Fiber).pendingProps,
                  null
                ))
                ? ((workInProgress as RR.Fiber).memoizedState = renderLanes)
                : isHydrating ||
                  ((workInProgress as RR.Fiber).stateNode = createHoistableInstance!(
                    (workInProgress as RR.Fiber).type,
                    (workInProgress as RR.Fiber).pendingProps,
                    rootInstanceStackCursor.current,
                    (workInProgress as RR.Fiber)
                  ))
              : ((workInProgress as RR.Fiber).memoizedState = getResource!(
                  (workInProgress as RR.Fiber).type,
                  (current as RR.Fiber | null)!.memoizedProps,
                  (workInProgress as RR.Fiber).pendingProps,
                  (current as RR.Fiber | null)!.memoizedState
                )),
            null
          );
      case 27:
        if (supportsSingletons)
          return (
            pushHostContext((workInProgress as RR.Fiber)),
            null === (current as RR.Fiber | null) &&
              supportsSingletons &&
              isHydrating &&
              ((props = (workInProgress as RR.Fiber).stateNode =
                resolveSingletonInstance!(
                  (workInProgress as RR.Fiber).type,
                  (workInProgress as RR.Fiber).pendingProps,
                  rootInstanceStackCursor.current,
                  contextStackCursor.current,
                  !1
                )),
              (hydrationParentFiber = (workInProgress as RR.Fiber)),
              (rootOrSingletonContext = !0),
              (nextHydratableInstance = getFirstHydratableChildWithinSingleton!(
                (workInProgress as RR.Fiber).type,
                props,
                nextHydratableInstance
              ))),
            reconcileChildren(
              (current as RR.Fiber | null),
              (workInProgress as RR.Fiber),
              (workInProgress as RR.Fiber).pendingProps.children,
              (renderLanes as RR.Lanes)
            ),
            markRef((current as RR.Fiber | null), (workInProgress as RR.Fiber)),
            null === (current as RR.Fiber | null) && ((workInProgress as RR.Fiber).flags |= 4194304),
            (workInProgress as RR.Fiber).child
          );
      case 5:
        if (null === (current as RR.Fiber | null) && isHydrating) {
          validateHydratableInstance!(
            (workInProgress as RR.Fiber).type,
            (workInProgress as RR.Fiber).pendingProps,
            contextStackCursor.current
          );
          if (($$typeof = props = nextHydratableInstance))
            (props = canHydrateInstance!(
              props,
              (workInProgress as RR.Fiber).type,
              (workInProgress as RR.Fiber).pendingProps,
              rootOrSingletonContext
            )),
              null !== props
                ? (((workInProgress as RR.Fiber).stateNode = props),
                  (hydrationParentFiber = (workInProgress as RR.Fiber)),
                  (nextHydratableInstance = getFirstHydratableChild!(props)),
                  (rootOrSingletonContext = !1),
                  ($$typeof = !0))
                : ($$typeof = !1);
          $$typeof || throwOnHydrationMismatch((workInProgress as RR.Fiber));
        }
        pushHostContext((workInProgress as RR.Fiber));
        $$typeof = (workInProgress as RR.Fiber).type;
        nextProps = (workInProgress as RR.Fiber).pendingProps;
        nextState = null !== (current as RR.Fiber | null) ? (current as RR.Fiber | null)!.memoizedProps : null;
        props = nextProps.children;
        shouldSetTextContent($$typeof, (nextProps as RR.PropsOrChildren))
          ? (props = null)
          : null !== (nextState as RR.Props | null) &&
            shouldSetTextContent($$typeof, (nextState as RR.Props | null)) &&
            ((workInProgress as RR.Fiber).flags |= 32);
        null !== (workInProgress as RR.Fiber).memoizedState &&
          (($$typeof = renderWithHooks(
            (current as RR.Fiber | null),
            (workInProgress as RR.Fiber),
            TransitionAwareHostComponent,
            null,
            null,
            (renderLanes as RR.Lanes)
          ) as RR.TransitionStatus),
          isPrimaryRenderer
            ? (HostTransitionContext._currentValue = $$typeof)
            : (HostTransitionContext._currentValue2 = $$typeof));
        markRef((current as RR.Fiber | null), (workInProgress as RR.Fiber));
        reconcileChildren((current as RR.Fiber | null), (workInProgress as RR.Fiber), props, (renderLanes as RR.Lanes));
        return (workInProgress as RR.Fiber).child;
      case 6:
        if (null === (current as RR.Fiber | null) && isHydrating) {
          validateHydratableTextInstance!(
            (workInProgress as RR.Fiber).pendingProps,
            contextStackCursor.current
          );
          if ((current = renderLanes = nextHydratableInstance))
            (renderLanes = canHydrateTextInstance!(
              renderLanes,
              (workInProgress as RR.Fiber).pendingProps,
              rootOrSingletonContext
            )),
              null !== renderLanes
                ? (((workInProgress as RR.Fiber).stateNode = renderLanes),
                  (hydrationParentFiber = (workInProgress as RR.Fiber)),
                  (nextHydratableInstance = null),
                  (current = !0))
                : (current = !1);
          current || throwOnHydrationMismatch((workInProgress as RR.Fiber));
        }
        return null;
      case 13:
        return updateSuspenseComponent((current as RR.Fiber | null), (workInProgress as RR.Fiber), (renderLanes as RR.Lanes));
      case 4:
        return (
          pushHostContainer(
            (workInProgress as RR.Fiber),
            ((workInProgress as RR.Fiber).stateNode as RR.PortalState).containerInfo
          ),
          (props = (workInProgress as RR.Fiber).pendingProps),
          null === (current as RR.Fiber | null)
            ? ((workInProgress as RR.Fiber).child = reconcileChildFibers(
                (workInProgress as RR.Fiber),
                null,
                props,
                (renderLanes as RR.Lanes)
              ))
            : reconcileChildren((current as RR.Fiber | null), (workInProgress as RR.Fiber), props, (renderLanes as RR.Lanes)),
          (workInProgress as RR.Fiber).child
        );
      case 11:
        return updateForwardRef(
          (current as RR.Fiber | null),
          (workInProgress as RR.Fiber),
          (workInProgress as RR.Fiber).type as RR.ForwardRefType,
          (workInProgress as RR.Fiber).pendingProps,
          (renderLanes as RR.Lanes)
        );
      case 7:
        return (
          reconcileChildren(
            (current as RR.Fiber | null),
            (workInProgress as RR.Fiber),
            (workInProgress as RR.Fiber).pendingProps,
            (renderLanes as RR.Lanes)
          ),
          (workInProgress as RR.Fiber).child
        );
      case 8:
        return (
          reconcileChildren(
            (current as RR.Fiber | null),
            (workInProgress as RR.Fiber),
            (workInProgress as RR.Fiber).pendingProps.children,
            (renderLanes as RR.Lanes)
          ),
          (workInProgress as RR.Fiber).child
        );
      case 12:
        return (
          reconcileChildren(
            (current as RR.Fiber | null),
            (workInProgress as RR.Fiber),
            (workInProgress as RR.Fiber).pendingProps.children,
            (renderLanes as RR.Lanes)
          ),
          (workInProgress as RR.Fiber).child
        );
      case 10:
        return (
          (props = (workInProgress as RR.Fiber).pendingProps),
          pushProvider((workInProgress as RR.Fiber), (workInProgress as RR.Fiber).type as RR.ReactContext, props.value),
          reconcileChildren(
            (current as RR.Fiber | null),
            (workInProgress as RR.Fiber),
            props.children,
            (renderLanes as RR.Lanes)
          ),
          (workInProgress as RR.Fiber).child
        );
      case 9:
        return (
          ($$typeof = ((workInProgress as RR.Fiber).type as RR.ConsumerType)._context),
          (props = (workInProgress as RR.Fiber).pendingProps.children),
          prepareToReadContext((workInProgress as RR.Fiber)),
          ($$typeof = readContext($$typeof)),
          (props = props($$typeof)),
          ((workInProgress as RR.Fiber).flags |= 1),
          reconcileChildren((current as RR.Fiber | null), (workInProgress as RR.Fiber), props, (renderLanes as RR.Lanes)),
          (workInProgress as RR.Fiber).child
        );
      case 14:
        return updateMemoComponent(
          (current as RR.Fiber | null),
          (workInProgress as RR.Fiber),
          (workInProgress as RR.Fiber).type as RR.MemoType,
          (workInProgress as RR.Fiber).pendingProps,
          (renderLanes as RR.Lanes)
        );
      case 15:
        return updateSimpleMemoComponent(
          (current as RR.Fiber | null),
          (workInProgress as RR.Fiber),
          (workInProgress as RR.Fiber).type as RR.FunctionComponent,
          (workInProgress as RR.Fiber).pendingProps,
          (renderLanes as RR.Lanes)
        );
      case 19:
        return updateSuspenseListComponent(
          (current as RR.Fiber | null),
          (workInProgress as RR.Fiber),
          (renderLanes as RR.Lanes)
        );
      case 31:
        return updateActivityComponent((current as RR.Fiber | null), (workInProgress as RR.Fiber), (renderLanes as RR.Lanes));
      case 22:
        return updateOffscreenComponent(
          (current as RR.Fiber | null),
          (workInProgress as RR.Fiber),
          (renderLanes as RR.Lanes),
          (((workInProgress as RR.Fiber).pendingProps as RR.OffscreenProps | RR.Lanes) as RR.OffscreenProps)
        );
      case 24:
        return (
          prepareToReadContext((workInProgress as RR.Fiber)),
          (props = readContext(CacheContext)),
          null === (current as RR.Fiber | null)
            ? (($$typeof = peekCacheFromPool()),
              null === $$typeof &&
                (($$typeof = workInProgressRoot!),
                (nextProps = createCache()),
                ($$typeof.pooledCache = (nextProps as RR.Cache)),
                (nextProps as RR.Cache).refCount++,
                null !== (nextProps as RR.Cache) &&
                  ($$typeof.pooledCacheLanes |= (renderLanes as RR.Lanes)),
                ($$typeof = (nextProps as RR.Cache))),
              ((workInProgress as RR.Fiber).memoizedState = {
                parent: props,
                cache: $$typeof
              } as RR.CacheComponentState),
              initializeUpdateQueue((workInProgress as RR.Fiber)),
              pushProvider((workInProgress as RR.Fiber), CacheContext, $$typeof))
            : (0 !== ((current as RR.Fiber | null)!.lanes & (renderLanes as RR.Lanes)) &&
                (cloneUpdateQueue((current as RR.Fiber | null)!, (workInProgress as RR.Fiber)),
                processUpdateQueue((workInProgress as RR.Fiber), null, null, (renderLanes as RR.Lanes)),
                suspendIfUpdateReadFromEntangledAsyncAction()),
              ($$typeof = (current as RR.Fiber | null)!.memoizedState as RR.CacheComponentState),
              (nextProps = (workInProgress as RR.Fiber).memoizedState),
              $$typeof.parent !== props
                ? (($$typeof = { parent: props, cache: props } as RR.CacheComponentState),
                  ((workInProgress as RR.Fiber).memoizedState = $$typeof),
                  0 === (workInProgress as RR.Fiber).lanes &&
                    ((workInProgress as RR.Fiber).memoizedState =
                      ((workInProgress as RR.Fiber).updateQueue as RR.UpdateQueue).baseState =
                        $$typeof),
                  pushProvider((workInProgress as RR.Fiber), CacheContext, props))
                : ((props = ((nextProps as RR.MemoizedState) as RR.CacheComponentState).cache),
                  pushProvider((workInProgress as RR.Fiber), CacheContext, props),
                  props !== $$typeof.cache &&
                    propagateContextChanges(
                      (workInProgress as RR.Fiber),
                      [CacheContext],
                      (renderLanes as RR.Lanes),
                      !0
                    ))),
          reconcileChildren(
            (current as RR.Fiber | null),
            (workInProgress as RR.Fiber),
            (workInProgress as RR.Fiber).pendingProps.children,
            (renderLanes as RR.Lanes)
          ),
          (workInProgress as RR.Fiber).child
        );
      case 29:
        throw (workInProgress as RR.Fiber).pendingProps;
    }
    throw Error(formatProdErrorMessage(156, (workInProgress as RR.Fiber).tag));
  }
  function markUpdate(workInProgress: RR.Fiber): void {
    workInProgress.flags |= 4;
  }
  function markCloned(workInProgress: RR.Fiber): void {
    supportsPersistence && (workInProgress.flags |= 8);
  }
  function doesRequireClone(current: RR.Fiber | null, completedWork: RR.Fiber): boolean {
    if (null !== current && current.child === completedWork.child) return !1;
    if (0 !== (completedWork.flags & 16)) return !0;
    for (current = completedWork.child; null !== current; ) {
      if (0 !== (current.flags & 8218) || 0 !== (current.subtreeFlags & 8218))
        return !0;
      current = current.sibling;
    }
    return !1;
  }
  function appendAllChildren(
    parent: RR.Instance,
    workInProgress: RR.Fiber,
    needsVisibilityToggle: boolean | RR.Fiber | null,
    isHidden: boolean
  ): void {
    if (supportsMutation)
      for (
        needsVisibilityToggle = workInProgress.child;
        null !== needsVisibilityToggle;

      ) {
        if (5 === needsVisibilityToggle.tag || 6 === needsVisibilityToggle.tag)
          appendInitialChild(parent, needsVisibilityToggle.stateNode);
        else if (
          !(
            4 === needsVisibilityToggle.tag ||
            (supportsSingletons && 27 === needsVisibilityToggle.tag)
          ) &&
          null !== needsVisibilityToggle.child
        ) {
          (needsVisibilityToggle as RR.Fiber | null)!.child!.return = needsVisibilityToggle;
          needsVisibilityToggle = needsVisibilityToggle.child;
          continue;
        }
        if (needsVisibilityToggle === workInProgress) break;
        for (; null === needsVisibilityToggle.sibling; ) {
          if (
            null === needsVisibilityToggle!.return ||
            needsVisibilityToggle.return === workInProgress
          )
            return;
          needsVisibilityToggle = needsVisibilityToggle!.return;
        }
        (needsVisibilityToggle as RR.Fiber | null)!.sibling!.return = needsVisibilityToggle.return;
        needsVisibilityToggle = needsVisibilityToggle.sibling;
      }
    else if (supportsPersistence)
      for (var node$85 = workInProgress.child; null !== node$85; ) {
        if (5 === node$85.tag) {
          var instance: RR.StateNode | RR.Fiber | null = node$85.stateNode;
          (needsVisibilityToggle as boolean) &&
            isHidden &&
            (instance = cloneHiddenInstance!(
              instance,
              node$85.type,
              node$85.memoizedProps
            ));
          appendInitialChild(parent, instance);
        } else if (6 === node$85.tag)
          (instance = node$85.stateNode),
            (needsVisibilityToggle as boolean) &&
              isHidden &&
              (instance = cloneHiddenTextInstance!(
                instance,
                node$85.memoizedProps
              )),
            appendInitialChild(parent, instance);
        else if (4 !== node$85.tag)
          if (22 === node$85.tag && null !== node$85.memoizedState)
            (instance = node$85.child),
              null !== instance && (instance.return = node$85),
              appendAllChildren(parent, node$85, !0, !0);
          else if (null !== node$85.child) {
            node$85.child.return = node$85;
            node$85 = node$85.child;
            continue;
          }
        if (node$85 === workInProgress) break;
        for (; null === node$85.sibling; ) {
          if (null === node$85.return || node$85.return === workInProgress)
            return;
          node$85 = node$85.return;
        }
        node$85.sibling.return = node$85.return;
        node$85 = node$85.sibling;
      }
  }
  function appendAllChildrenToContainer(
    containerChildSet: RR.ChildSet,
    workInProgress: RR.Fiber,
    needsVisibilityToggle: boolean,
    isHidden: boolean
  ): boolean {
    var hasOffscreenComponentChild: boolean | RR.Fiber | null = !1;
    if (supportsPersistence)
      for (var node = workInProgress.child; null !== node; ) {
        if (5 === node.tag) {
          var instance: RR.StateNode = node.stateNode;
          needsVisibilityToggle &&
            isHidden &&
            (instance = cloneHiddenInstance!(
              instance,
              node.type,
              node.memoizedProps
            ));
          appendChildToContainerChildSet!(containerChildSet, instance);
        } else if (6 === node.tag)
          (instance = node.stateNode),
            needsVisibilityToggle &&
              isHidden &&
              (instance = cloneHiddenTextInstance!(
                instance,
                node.memoizedProps
              )),
            appendChildToContainerChildSet!(containerChildSet, instance);
        else if (4 !== node.tag)
          if (22 === node.tag && null !== node.memoizedState)
            (hasOffscreenComponentChild = node.child),
              null !== hasOffscreenComponentChild &&
                (hasOffscreenComponentChild.return = node),
              appendAllChildrenToContainer(containerChildSet, node, !0, !0),
              (hasOffscreenComponentChild = !0);
          else if (null !== node.child) {
            node.child.return = node;
            node = node.child;
            continue;
          }
        if (node === workInProgress) break;
        for (; null === node.sibling; ) {
          if (null === node.return || node.return === workInProgress)
            return hasOffscreenComponentChild;
          node = node.return;
        }
        node.sibling.return = node.return;
        node = node.sibling;
      }
    return hasOffscreenComponentChild;
  }
  function updateHostContainer(current: RR.Fiber | RR.FiberRoot | RR.PortalState | null, workInProgress: RR.Fiber): void {
    if (supportsPersistence && doesRequireClone((current as RR.Fiber | null), workInProgress)) {
      current = workInProgress.stateNode as RR.FiberRoot | RR.PortalState;
      var container = current.containerInfo,
        newChildSet = createContainerChildSet!();
      appendAllChildrenToContainer(newChildSet, workInProgress, !1, !1);
      current.pendingChildren = newChildSet;
      markUpdate(workInProgress);
      finalizeContainerChildren!(container, newChildSet);
    }
  }
  function updateHostComponent(current: RR.Fiber | boolean, workInProgress: RR.Fiber, type: RR.HostType, newProps: RR.PropsArg): void {
    if (supportsMutation)
      (current as RR.Fiber).memoizedProps !== newProps && markUpdate(workInProgress);
    else if (supportsPersistence) {
      var currentInstance = (current as RR.Fiber).stateNode,
        oldProps$88: RR.Props | RR.Instance = (current as RR.Fiber).memoizedProps;
      if (
        (current = doesRequireClone((current as RR.Fiber), workInProgress)) ||
        (oldProps$88 as RR.Props) !== newProps
      ) {
        var currentHostContext = contextStackCursor.current;
        oldProps$88 = cloneInstance!(
          currentInstance,
          type,
          (oldProps$88 as RR.Props),
          newProps,
          !current,
          null
        );
        oldProps$88 === currentInstance
          ? (workInProgress.stateNode = currentInstance)
          : (markCloned(workInProgress),
            finalizeInitialChildren(
              oldProps$88,
              type,
              newProps,
              currentHostContext
            ) && markUpdate(workInProgress),
            (workInProgress.stateNode = oldProps$88),
            current && appendAllChildren(oldProps$88, workInProgress, !1, !1));
      } else workInProgress.stateNode = currentInstance;
    }
  }
  function preloadInstanceAndSuspendIfNeeded(
    workInProgress: RR.Fiber,
    type: RR.HostType,
    oldProps: RR.PropsArg,
    newProps: RR.PropsArg,
    renderLanes: RR.Lanes
  ): void {
    if (
      0 !== (workInProgress.mode & 32) &&
      (null === oldProps
        ? maySuspendCommit(type, newProps)
        : maySuspendCommitOnUpdate!(type, oldProps, newProps))
    ) {
      if (
        ((workInProgress.flags |= 16777216),
        (renderLanes & 335544128) === renderLanes ||
          maySuspendCommitInSyncRender!(type, newProps))
      )
        if (preloadInstance(workInProgress.stateNode, type, newProps))
          workInProgress.flags |= 8192;
        else if (shouldRemainOnPreviousScreen()) workInProgress.flags |= 8192;
        else
          throw (
            ((suspendedThenable = noopSuspenseyCommitThenable),
            SuspenseyCommitException)
          );
    } else workInProgress.flags &= -16777217;
  }
  function preloadResourceAndSuspendIfNeeded(workInProgress: RR.Fiber, resource: RR.ResourceArg): void {
    if (mayResourceSuspendCommit!(resource)) {
      if (((workInProgress.flags |= 16777216), !preloadResource!(resource)))
        if (shouldRemainOnPreviousScreen()) workInProgress.flags |= 8192;
        else
          throw (
            ((suspendedThenable = noopSuspenseyCommitThenable),
            SuspenseyCommitException)
          );
    } else workInProgress.flags &= -16777217;
  }
  function scheduleRetryEffect(workInProgress: RR.Fiber, retryQueue: RR.FiberUpdateQueue | number): void {
    null !== (retryQueue as RR.FiberUpdateQueue) && (workInProgress.flags |= 4);
    workInProgress.flags & 16384 &&
      ((retryQueue =
        22 !== workInProgress.tag ? claimNextRetryLane() : 536870912),
      (workInProgress.lanes |= retryQueue),
      (workInProgressSuspendedRetryLanes |= retryQueue));
  }
  function cutOffTailIfNeeded(renderState: RR.SuspenseListRenderState, hasRenderedATailFallback: boolean | RR.Fiber | null): void {
    if (!isHydrating)
      switch (renderState.tailMode) {
        case "hidden":
          hasRenderedATailFallback = renderState.tail;
          for (var lastTailNode: RR.Fiber | null = null; null !== hasRenderedATailFallback; )
            null !== hasRenderedATailFallback.alternate &&
              (lastTailNode = hasRenderedATailFallback),
              (hasRenderedATailFallback = hasRenderedATailFallback.sibling);
          null === lastTailNode
            ? (renderState.tail = null)
            : (lastTailNode.sibling = null);
          break;
        case "collapsed":
          lastTailNode = renderState.tail;
          for (var lastTailNode$90: RR.Fiber | null = null; null !== lastTailNode; )
            null !== lastTailNode.alternate && (lastTailNode$90 = lastTailNode),
              (lastTailNode = lastTailNode.sibling);
          null === lastTailNode$90
            ? (hasRenderedATailFallback as boolean) || null === renderState.tail
              ? (renderState.tail = null)
              : (renderState.tail.sibling = null)
            : (lastTailNode$90.sibling = null);
      }
  }
  function bubbleProperties(completedWork: RR.Fiber): boolean {
    var didBailout =
        null !== completedWork.alternate &&
        completedWork.alternate.child === completedWork.child,
      newChildLanes: RR.Lanes = 0,
      subtreeFlags: RR.Flags = 0;
    if (didBailout)
      for (var child$91 = completedWork.child; null !== child$91; )
        (newChildLanes |= child$91.lanes | child$91.childLanes),
          (subtreeFlags |= child$91.subtreeFlags & 65011712),
          (subtreeFlags |= child$91.flags & 65011712),
          (child$91.return = completedWork),
          (child$91 = child$91.sibling);
    else
      for (child$91 = completedWork.child; null !== child$91; )
        (newChildLanes |= child$91.lanes | child$91.childLanes),
          (subtreeFlags |= child$91.subtreeFlags),
          (subtreeFlags |= child$91.flags),
          (child$91.return = completedWork),
          (child$91 = child$91.sibling);
    completedWork.subtreeFlags |= subtreeFlags;
    completedWork.childLanes = newChildLanes;
    return didBailout;
  }
  function completeWork(current: RR.Fiber | RR.HostContext | RR.HostObject | RR.SuspenseState | boolean | RR.FiberUpdateQueue | null, workInProgress: RR.Fiber, renderLanes: RR.Lanes | RR.FiberRoot | RR.HostObject | RR.HostContext | string | RR.MemoizedState | RR.CapturedValue[] | boolean | RR.Fiber | RR.OffscreenQueue | RR.Cache | null): RR.Fiber | null {
    var newProps: RR.PropsInUnion | RR.Cache | boolean | RR.SuspenseState | RR.Fiber | RR.SuspenseListRenderState | null = workInProgress.pendingProps;
    popTreeContext(workInProgress);
    switch (workInProgress.tag) {
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return bubbleProperties(workInProgress), null;
      case 1:
        return bubbleProperties(workInProgress), null;
      case 3:
        renderLanes = workInProgress.stateNode as RR.FiberRoot;
        newProps = null;
        null !== (current as RR.Fiber | null) && (newProps = ((current as RR.Fiber | null)!.memoizedState as RR.RootState).cache);
        (workInProgress.memoizedState as RR.RootState).cache !== newProps &&
          (workInProgress.flags |= 2048);
        popProvider(CacheContext);
        popHostContainer();
        renderLanes.pendingContext &&
          ((renderLanes.context = renderLanes.pendingContext),
          (renderLanes.pendingContext = null));
        if (null === (current as RR.Fiber | null) || null === (current as RR.Fiber | null)!.child)
          popHydrationState(workInProgress)
            ? markUpdate(workInProgress)
            : null === (current as RR.Fiber | null) ||
              (((current as RR.Fiber | null)!.memoizedState as RR.RootState).isDehydrated &&
                0 === (workInProgress.flags & 256)) ||
              ((workInProgress.flags |= 1024),
              upgradeHydrationErrorsToRecoverable());
        updateHostContainer((current as RR.Fiber | null), workInProgress);
        bubbleProperties(workInProgress);
        return null;
      case 26:
        if (supportsResources) {
          var type: RR.ElementType | RR.Fiber | boolean | RR.SuspenseState | RR.SuspenseInstance | RR.CapturedValue[] | RR.Cache | null = workInProgress.type,
            nextResource: RR.MemoizedState | RR.Props | RR.HostContext | RR.Cache | RR.Fiber | null = workInProgress.memoizedState;
          null === (current as RR.Fiber | null)
            ? (markUpdate(workInProgress),
              null !== nextResource
                ? (bubbleProperties(workInProgress),
                  preloadResourceAndSuspendIfNeeded(
                    workInProgress,
                    nextResource
                  ))
                : (bubbleProperties(workInProgress),
                  preloadInstanceAndSuspendIfNeeded(
                    workInProgress,
                    type,
                    null,
                    (newProps as RR.PropsInUnion),
                    (renderLanes as RR.Lanes) as RR.Lanes
                  )))
            : nextResource
              ? nextResource !== (current as RR.Fiber | null)!.memoizedState
                ? (markUpdate(workInProgress),
                  bubbleProperties(workInProgress),
                  preloadResourceAndSuspendIfNeeded(
                    workInProgress,
                    nextResource
                  ))
                : (bubbleProperties(workInProgress),
                  (workInProgress.flags &= -16777217))
              : ((nextResource = (current as RR.Fiber | null)!.memoizedProps),
                supportsMutation
                  ? (nextResource as RR.Props) !== (newProps as RR.PropsInUnion) && markUpdate(workInProgress)
                  : updateHostComponent(
                      (current as RR.Fiber | null)!,
                      workInProgress,
                      type,
                      (newProps as RR.PropsInUnion)
                    ),
                bubbleProperties(workInProgress),
                preloadInstanceAndSuspendIfNeeded(
                  workInProgress,
                  type,
                  (nextResource as RR.Props),
                  (newProps as RR.PropsInUnion),
                  (renderLanes as RR.Lanes) as RR.Lanes
                ));
          return null;
        }
      case 27:
        if (supportsSingletons) {
          popHostContext(workInProgress);
          renderLanes = rootInstanceStackCursor.current;
          type = workInProgress.type;
          if (null !== (current as RR.Fiber | null) && null != workInProgress.stateNode)
            supportsMutation
              ? (current as RR.Fiber | null)!.memoizedProps !== (newProps as RR.PropsInUnion) && markUpdate(workInProgress)
              : updateHostComponent((current as RR.Fiber | null)!, workInProgress, type, (newProps as RR.PropsInUnion));
          else {
            if (!(newProps as RR.PropsInUnion)) {
              if (null === workInProgress.stateNode)
                throw Error(formatProdErrorMessage(166));
              bubbleProperties(workInProgress);
              return null;
            }
            current = contextStackCursor.current;
            popHydrationState(workInProgress)
              ? prepareToHydrateHostInstance(workInProgress, current)
              : ((current = resolveSingletonInstance!(
                  type,
                  (newProps as RR.PropsInUnion),
                  renderLanes,
                  current,
                  !0
                )),
                (workInProgress.stateNode = current),
                markUpdate(workInProgress));
          }
          bubbleProperties(workInProgress);
          return null;
        }
      case 5:
        popHostContext(workInProgress);
        type = workInProgress.type;
        if (null !== (current as RR.Fiber | null) && null != workInProgress.stateNode)
          updateHostComponent((current as RR.Fiber | null)!, workInProgress, type, (newProps as RR.PropsInUnion));
        else {
          if (!(newProps as RR.PropsInUnion)) {
            if (null === workInProgress.stateNode)
              throw Error(formatProdErrorMessage(166));
            bubbleProperties(workInProgress);
            return null;
          }
          nextResource = contextStackCursor.current;
          if (popHydrationState(workInProgress))
            prepareToHydrateHostInstance(workInProgress, nextResource),
              finalizeHydratedChildren!(
                workInProgress.stateNode,
                type,
                (newProps as RR.PropsInUnion),
                nextResource
              ) && (workInProgress.flags |= 64);
          else {
            var instance$101 = createInstance(
              type,
              (newProps as RR.PropsInUnion),
              rootInstanceStackCursor.current,
              nextResource,
              workInProgress
            );
            markCloned(workInProgress);
            appendAllChildren(instance$101, workInProgress, !1, !1);
            workInProgress.stateNode = instance$101;
            finalizeInitialChildren(
              instance$101,
              type,
              (newProps as RR.PropsInUnion),
              nextResource
            ) && markUpdate(workInProgress);
          }
        }
        bubbleProperties(workInProgress);
        preloadInstanceAndSuspendIfNeeded(
          workInProgress,
          workInProgress.type,
          null === (current as RR.Fiber | null) ? null : (current as RR.Fiber | null)!.memoizedProps,
          workInProgress.pendingProps,
          (renderLanes as RR.Lanes) as RR.Lanes
        );
        return null;
      case 6:
        if ((current as RR.Fiber | null) && null != workInProgress.stateNode)
          (renderLanes = (current as RR.Fiber | null)!.memoizedProps),
            supportsMutation
              ? renderLanes !== (newProps as RR.PropsInUnion) && markUpdate(workInProgress)
              : supportsPersistence &&
                (renderLanes !== (newProps as RR.PropsInUnion)
                  ? ((current = rootInstanceStackCursor.current),
                    (renderLanes = contextStackCursor.current),
                    markCloned(workInProgress),
                    (workInProgress.stateNode = createTextInstance(
                      (newProps as RR.PropsInUnion) as string,
                      current,
                      renderLanes,
                      workInProgress
                    )))
                  : (workInProgress.stateNode = (current as RR.Fiber | null)!.stateNode));
        else {
          if ("string" !== typeof newProps && null === workInProgress.stateNode)
            throw Error(formatProdErrorMessage(166));
          current = rootInstanceStackCursor.current;
          renderLanes = contextStackCursor.current;
          if (popHydrationState(workInProgress)) {
            if (!supportsHydration) throw Error(formatProdErrorMessage(176));
            current = workInProgress.stateNode as RR.TextInstance;
            renderLanes = workInProgress.memoizedProps as string;
            newProps = null;
            type = hydrationParentFiber;
            if (null !== type)
              switch (type.tag) {
                case 27:
                case 5:
                  newProps = type.memoizedProps;
              }
            hydrateTextInstance!(
              current,
              renderLanes,
              workInProgress,
              (newProps as RR.PropsInUnion)
            ) || throwOnHydrationMismatch(workInProgress, !0);
          } else
            markCloned(workInProgress),
              (workInProgress.stateNode = createTextInstance(
                (newProps as RR.PropsInUnion) as string,
                current,
                renderLanes,
                workInProgress
              ));
        }
        bubbleProperties(workInProgress);
        return null;
      case 31:
        renderLanes = workInProgress.memoizedState;
        if (null === (current as RR.Fiber | null) || null !== (current as RR.Fiber | null)!.memoizedState) {
          newProps = popHydrationState(workInProgress);
          if (null !== renderLanes) {
            if (null === (current as RR.Fiber | null)) {
              if (!newProps) throw Error(formatProdErrorMessage(318));
              if (!supportsHydration) throw Error(formatProdErrorMessage(556));
              current = workInProgress.memoizedState as RR.ActivityState | null;
              current = null !== current ? current.dehydrated : null;
              if (!current) throw Error(formatProdErrorMessage(557));
              hydrateActivityInstance!(current, workInProgress);
            } else
              resetHydrationState(),
                0 === (workInProgress.flags & 128) &&
                  (workInProgress.memoizedState = null),
                (workInProgress.flags |= 4);
            bubbleProperties(workInProgress);
            current = !1;
          } else
            (renderLanes = upgradeHydrationErrorsToRecoverable()),
              null !== (current as RR.Fiber | null) &&
                null !== (current as RR.Fiber | null)!.memoizedState &&
                (((current as RR.Fiber | null)!.memoizedState as RR.ActivityState).hydrationErrors = renderLanes),
              (current = !0);
          if (!current) {
            if (workInProgress.flags & 256)
              return popSuspenseHandler(workInProgress), workInProgress;
            popSuspenseHandler(workInProgress);
            return null;
          }
          if (0 !== (workInProgress.flags & 128))
            throw Error(formatProdErrorMessage(558));
        }
        bubbleProperties(workInProgress);
        return null;
      case 13:
        newProps = workInProgress.memoizedState as RR.SuspenseState | null;
        if (
          null === (current as RR.Fiber | null) ||
          (null !== (current as RR.Fiber | null)!.memoizedState &&
            null !== ((current as RR.Fiber | null)!.memoizedState as RR.SuspenseState).dehydrated)
        ) {
          type = popHydrationState(workInProgress);
          if (null !== newProps && null !== newProps.dehydrated) {
            if (null === (current as RR.Fiber | null)) {
              if (!type) throw Error(formatProdErrorMessage(318));
              if (!supportsHydration) throw Error(formatProdErrorMessage(344));
              type = workInProgress.memoizedState as RR.SuspenseState | null;
              type = null !== type ? type.dehydrated : null;
              if (!type) throw Error(formatProdErrorMessage(317));
              hydrateSuspenseInstance!(type, workInProgress);
            } else
              resetHydrationState(),
                0 === (workInProgress.flags & 128) &&
                  (workInProgress.memoizedState = null),
                (workInProgress.flags |= 4);
            bubbleProperties(workInProgress);
            type = !1;
          } else
            (type = upgradeHydrationErrorsToRecoverable()),
              null !== (current as RR.Fiber | null) &&
                null !== (current as RR.Fiber | null)!.memoizedState &&
                (((current as RR.Fiber | null)!.memoizedState as RR.SuspenseState).hydrationErrors = type),
              (type = !0);
          if (!type) {
            if (workInProgress.flags & 256)
              return popSuspenseHandler(workInProgress), workInProgress;
            popSuspenseHandler(workInProgress);
            return null;
          }
        }
        popSuspenseHandler(workInProgress);
        if (0 !== (workInProgress.flags & 128))
          return (workInProgress.lanes = (renderLanes as RR.Lanes) as RR.Lanes), workInProgress;
        renderLanes = null !== newProps;
        current = null !== (current as RR.Fiber | null) && null !== (current as RR.Fiber | null)!.memoizedState;
        renderLanes &&
          ((newProps = workInProgress.child!),
          (type = null),
          null !== newProps.alternate &&
            null !== (newProps as RR.Fiber).alternate!.memoizedState &&
            null !== ((newProps as RR.Fiber).alternate!.memoizedState as RR.OffscreenState).cachePool &&
            (type = ((newProps as RR.Fiber).alternate!.memoizedState as RR.OffscreenState).cachePool!.pool),
          (nextResource = null),
          null !== newProps.memoizedState &&
            null !== (newProps.memoizedState as RR.OffscreenState).cachePool &&
            (nextResource = (newProps.memoizedState as RR.OffscreenState).cachePool!.pool),
          nextResource !== type && (newProps.flags |= 2048));
        renderLanes !== current &&
          renderLanes &&
          (workInProgress.child!.flags |= 8192);
        scheduleRetryEffect(workInProgress, workInProgress.updateQueue);
        bubbleProperties(workInProgress);
        return null;
      case 4:
        return (
          popHostContainer(),
          updateHostContainer((current as RR.Fiber | null), workInProgress),
          null === (current as RR.Fiber | null) &&
            preparePortalMount((workInProgress.stateNode as RR.PortalState).containerInfo),
          bubbleProperties(workInProgress),
          null
        );
      case 10:
        return (
          popProvider(workInProgress.type as RR.ReactContext),
          bubbleProperties(workInProgress),
          null
        );
      case 19:
        pop(suspenseStackCursor);
        newProps = workInProgress.memoizedState as RR.SuspenseListRenderState | null;
        if (null === newProps) return bubbleProperties(workInProgress), null;
        type = 0 !== (workInProgress.flags & 128);
        nextResource = newProps.rendering;
        if (null === nextResource)
          if (type) cutOffTailIfNeeded(newProps, !1);
          else {
            if (
              0 !== workInProgressRootExitStatus ||
              (null !== (current as RR.Fiber | null) && 0 !== ((current as RR.Fiber | null)!.flags & 128))
            )
              for (current = workInProgress.child; null !== current; ) {
                nextResource = findFirstSuspended(current);
                if (null !== nextResource) {
                  workInProgress.flags |= 128;
                  cutOffTailIfNeeded(newProps, !1);
                  current = nextResource.updateQueue;
                  workInProgress.updateQueue = current;
                  scheduleRetryEffect(workInProgress, current);
                  workInProgress.subtreeFlags = 0;
                  current = (renderLanes as RR.Lanes);
                  for (
                    renderLanes = workInProgress.child;
                    null !== renderLanes;

                  )
                    resetWorkInProgress(renderLanes, current as RR.Lanes),
                      (renderLanes = renderLanes.sibling);
                  push(
                    suspenseStackCursor,
                    (suspenseStackCursor.current & 1) | 2
                  );
                  isHydrating &&
                    pushTreeFork(workInProgress, newProps.treeForkCount);
                  return workInProgress.child;
                }
                current = current.sibling;
              }
            null !== newProps.tail &&
              now() > workInProgressRootRenderTargetTime &&
              ((workInProgress.flags |= 128),
              (type = !0),
              cutOffTailIfNeeded(newProps, !1),
              (workInProgress.lanes = 4194304));
          }
        else {
          if (!type)
            if (
              ((current = findFirstSuspended(nextResource)), null !== current)
            ) {
              if (
                ((workInProgress.flags |= 128),
                (type = !0),
                (current = current.updateQueue),
                (workInProgress.updateQueue = current),
                scheduleRetryEffect(workInProgress, current),
                cutOffTailIfNeeded(newProps, !0),
                null === newProps.tail &&
                  "hidden" === newProps.tailMode &&
                  !nextResource.alternate &&
                  !isHydrating)
              )
                return bubbleProperties(workInProgress), null;
            } else
              2 * now() - newProps.renderingStartTime >
                workInProgressRootRenderTargetTime &&
                536870912 !== (renderLanes as RR.Lanes) &&
                ((workInProgress.flags |= 128),
                (type = !0),
                cutOffTailIfNeeded(newProps, !1),
                (workInProgress.lanes = 4194304));
          newProps.isBackwards
            ? ((nextResource.sibling = workInProgress.child),
              (workInProgress.child = nextResource))
            : ((current = newProps.last),
              null !== current
                ? (current.sibling = nextResource)
                : (workInProgress.child = nextResource),
              (newProps.last = nextResource));
        }
        if (null !== newProps.tail)
          return (
            (current = newProps.tail),
            (newProps.rendering = current),
            (newProps.tail = current.sibling),
            (newProps.renderingStartTime = now()),
            (current.sibling = null),
            (renderLanes = suspenseStackCursor.current),
            push(
              suspenseStackCursor,
              type ? (renderLanes & 1) | 2 : renderLanes & 1
            ),
            isHydrating && pushTreeFork(workInProgress, newProps.treeForkCount),
            current
          );
        bubbleProperties(workInProgress);
        return null;
      case 22:
      case 23:
        return (
          popSuspenseHandler(workInProgress),
          popHiddenContext(),
          (newProps = null !== workInProgress.memoizedState),
          null !== (current as RR.Fiber | null)
            ? (null !== (current as RR.Fiber | null)!.memoizedState) !== newProps &&
              (workInProgress.flags |= 8192)
            : newProps && (workInProgress.flags |= 8192),
          newProps
            ? 0 !== ((renderLanes as RR.Lanes) & 536870912) &&
              0 === (workInProgress.flags & 128) &&
              (bubbleProperties(workInProgress),
              workInProgress.subtreeFlags & 6 && (workInProgress.flags |= 8192))
            : bubbleProperties(workInProgress),
          (renderLanes = workInProgress.updateQueue as RR.OffscreenQueue | null),
          null !== renderLanes &&
            scheduleRetryEffect(workInProgress, renderLanes.retryQueue),
          (renderLanes = null),
          null !== (current as RR.Fiber | null) &&
            null !== (current as RR.Fiber | null)!.memoizedState &&
            null !== ((current as RR.Fiber | null)!.memoizedState as RR.OffscreenState).cachePool &&
            (renderLanes = ((current as RR.Fiber | null)!.memoizedState as RR.OffscreenState).cachePool!.pool),
          (newProps = null),
          null !== workInProgress.memoizedState &&
            null !== (workInProgress.memoizedState as RR.OffscreenState).cachePool &&
            (newProps = (workInProgress.memoizedState as RR.OffscreenState).cachePool!.pool),
          newProps !== renderLanes && (workInProgress.flags |= 2048),
          null !== (current as RR.Fiber | null) && pop(resumedCache),
          null
        );
      case 24:
        return (
          (renderLanes = null),
          null !== (current as RR.Fiber | null) && (renderLanes = ((current as RR.Fiber | null)!.memoizedState as RR.CacheComponentState).cache),
          (workInProgress.memoizedState as RR.CacheComponentState).cache !== renderLanes &&
            (workInProgress.flags |= 2048),
          popProvider(CacheContext),
          bubbleProperties(workInProgress),
          null
        );
      case 25:
        return null;
      case 30:
        return null;
    }
    throw Error(formatProdErrorMessage(156, workInProgress.tag));
  }
  function unwindWork(current: RR.Fiber | number | RR.SuspenseState | null, workInProgress: RR.Fiber): RR.Fiber | null {
    popTreeContext(workInProgress);
    switch (workInProgress.tag) {
      case 1:
        return (
          (current = workInProgress.flags),
          current & 65536
            ? ((workInProgress.flags = (current & -65537) | 128),
              workInProgress)
            : null
        );
      case 3:
        return (
          popProvider(CacheContext),
          popHostContainer(),
          (current = workInProgress.flags),
          0 !== (current & 65536) && 0 === (current & 128)
            ? ((workInProgress.flags = (current & -65537) | 128),
              workInProgress)
            : null
        );
      case 26:
      case 27:
      case 5:
        return popHostContext(workInProgress), null;
      case 31:
        if (null !== workInProgress.memoizedState) {
          popSuspenseHandler(workInProgress);
          if (null === workInProgress.alternate)
            throw Error(formatProdErrorMessage(340));
          resetHydrationState();
        }
        current = workInProgress.flags;
        return current & 65536
          ? ((workInProgress.flags = (current & -65537) | 128), workInProgress)
          : null;
      case 13:
        popSuspenseHandler(workInProgress);
        current = workInProgress.memoizedState as RR.SuspenseState | null;
        if (null !== current && null !== current.dehydrated) {
          if (null === workInProgress.alternate)
            throw Error(formatProdErrorMessage(340));
          resetHydrationState();
        }
        current = workInProgress.flags;
        return current & 65536
          ? ((workInProgress.flags = (current & -65537) | 128), workInProgress)
          : null;
      case 19:
        return pop(suspenseStackCursor), null;
      case 4:
        return popHostContainer(), null;
      case 10:
        return popProvider(workInProgress.type as RR.ReactContext), null;
      case 22:
      case 23:
        return (
          popSuspenseHandler(workInProgress),
          popHiddenContext(),
          null !== (current as RR.Fiber | null) && pop(resumedCache),
          (current = workInProgress.flags),
          current & 65536
            ? ((workInProgress.flags = (current & -65537) | 128),
              workInProgress)
            : null
        );
      case 24:
        return popProvider(CacheContext), null;
      case 25:
        return null;
      default:
        return null;
    }
  }
  function unwindInterruptedWork(current: RR.Fiber | null, interruptedWork: RR.Fiber): void {
    popTreeContext(interruptedWork);
    switch (interruptedWork.tag) {
      case 3:
        popProvider(CacheContext);
        popHostContainer();
        break;
      case 26:
      case 27:
      case 5:
        popHostContext(interruptedWork);
        break;
      case 4:
        popHostContainer();
        break;
      case 31:
        null !== interruptedWork.memoizedState &&
          popSuspenseHandler(interruptedWork);
        break;
      case 13:
        popSuspenseHandler(interruptedWork);
        break;
      case 19:
        pop(suspenseStackCursor);
        break;
      case 10:
        popProvider(interruptedWork.type as RR.ReactContext);
        break;
      case 22:
      case 23:
        popSuspenseHandler(interruptedWork);
        popHiddenContext();
        null !== current && pop(resumedCache);
        break;
      case 24:
        popProvider(CacheContext);
    }
  }
  function commitHookEffectListMount(flags: RR.HookFlags, finishedWork: RR.Fiber): void {
    try {
      var updateQueue: RR.FunctionComponentUpdateQueue | RR.Effect | null = finishedWork.updateQueue as RR.FunctionComponentUpdateQueue | null,
        lastEffect: RR.Effect | RR.EffectDestroy | void | null = null !== updateQueue ? updateQueue.lastEffect : null;
      if (null !== lastEffect) {
        var firstEffect = lastEffect.next;
        updateQueue = firstEffect;
        do {
          if ((updateQueue!.tag & flags) === flags) {
            lastEffect = void 0;
            var create = updateQueue!.create,
              inst = updateQueue!.inst;
            lastEffect = create();
            inst.destroy = lastEffect;
          }
          updateQueue = updateQueue!.next;
        } while (updateQueue !== firstEffect);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function commitHookEffectListUnmount(
    flags: RR.HookFlags,
    finishedWork: RR.Fiber,
    nearestMountedAncestor$jscomp$0: RR.Fiber | null
  ): void {
    try {
      var updateQueue: RR.FunctionComponentUpdateQueue | RR.Effect | null = finishedWork.updateQueue as RR.FunctionComponentUpdateQueue | null,
        lastEffect: RR.Effect | RR.Fiber | null = null !== updateQueue ? updateQueue.lastEffect : null;
      if (null !== lastEffect) {
        var firstEffect = lastEffect.next;
        updateQueue = firstEffect;
        do {
          if ((updateQueue!.tag & flags) === flags) {
            var inst = updateQueue!.inst,
              destroy = inst.destroy;
            if (void 0 !== destroy) {
              inst.destroy = void 0;
              lastEffect = finishedWork;
              var nearestMountedAncestor = nearestMountedAncestor$jscomp$0,
                destroy_ = destroy as RR.EffectDestroy;
              try {
                destroy_();
              } catch (error) {
                captureCommitPhaseError(
                  lastEffect,
                  nearestMountedAncestor,
                  error
                );
              }
            }
          }
          updateQueue = updateQueue!.next;
        } while (updateQueue !== firstEffect);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function commitClassCallbacks(finishedWork: RR.Fiber): void {
    var updateQueue: RR.UpdateQueue | null = finishedWork.updateQueue as RR.UpdateQueue | null;
    if (null !== updateQueue) {
      var instance = finishedWork.stateNode;
      try {
        commitCallbacks(updateQueue, instance);
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
    }
  }
  function safelyCallComponentWillUnmount(
    current: RR.Fiber,
    nearestMountedAncestor: RR.Fiber | null,
    instance: RR.ClassInstance
  ): void {
    instance.props = resolveClassComponentProps(
      current.type as RR.ClassComponent,
      current.memoizedProps
    );
    instance.state = current.memoizedState;
    try {
      instance.componentWillUnmount!();
    } catch (error) {
      captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
  }
  function safelyAttachRef(current: RR.Fiber, nearestMountedAncestor: RR.Fiber | null): void {
    try {
      var ref = current.ref;
      if (null !== ref) {
        switch (current.tag) {
          case 26:
          case 27:
          case 5:
            var instanceToUse: RR.StateNode = getPublicInstance(current.stateNode);
            break;
          case 30:
            instanceToUse = current.stateNode;
            break;
          default:
            instanceToUse = current.stateNode;
        }
        "function" === typeof ref
          ? (current.refCleanup = ref(instanceToUse))
          : (ref.current = instanceToUse);
      }
    } catch (error) {
      captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
  }
  function safelyDetachRef(current: RR.Fiber | null, nearestMountedAncestor: RR.Fiber | null): void {
    var ref = current!.ref,
      refCleanup = current!.refCleanup;
    if (null !== ref)
      if ("function" === typeof refCleanup)
        try {
          refCleanup();
        } catch (error) {
          captureCommitPhaseError((current as RR.Fiber), nearestMountedAncestor, error);
        } finally {
          (current!.refCleanup = null),
            (current = current!.alternate),
            null != current && (current.refCleanup = null);
        }
      else if ("function" === typeof ref)
        try {
          ref(null);
        } catch (error$124) {
          captureCommitPhaseError((current as RR.Fiber), nearestMountedAncestor, error$124);
        }
      else ref.current = null;
  }
  function commitHostMount(finishedWork: RR.Fiber): void {
    var type = finishedWork.type,
      props: RR.Props = finishedWork.memoizedProps,
      instance = finishedWork.stateNode;
    try {
      commitMount!(instance, type, props, finishedWork);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function commitHostUpdate(finishedWork: RR.Fiber, newProps: RR.Props, oldProps: RR.Props): void {
    try {
      commitUpdate!(
        finishedWork.stateNode,
        finishedWork.type,
        oldProps,
        newProps,
        finishedWork
      );
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function isHostParent(fiber: RR.Fiber): boolean {
    return (
      5 === fiber.tag ||
      3 === fiber.tag ||
      (supportsResources ? 26 === fiber.tag : !1) ||
      (supportsSingletons
        ? 27 === fiber.tag && isSingletonScope!(fiber.type)
        : !1) ||
      4 === fiber.tag
    );
  }
  function getHostSibling(fiber: RR.Fiber): RR.StateNode {
    a: for (;;) {
      for (; null === fiber.sibling; ) {
        if (null === fiber.return || isHostParent(fiber.return)) return null;
        fiber = fiber.return;
      }
      fiber.sibling.return = fiber.return;
      for (
        fiber = fiber.sibling;
        5 !== fiber.tag && 6 !== fiber.tag && 18 !== fiber.tag;

      ) {
        if (
          supportsSingletons &&
          27 === fiber.tag &&
          isSingletonScope!(fiber.type)
        )
          continue a;
        if (fiber.flags & 2) continue a;
        if (null === fiber.child || 4 === fiber.tag) continue a;
        else (fiber.child.return = fiber), (fiber = fiber.child);
      }
      if (!(fiber.flags & 2)) return fiber.stateNode;
    }
  }
  function insertOrAppendPlacementNodeIntoContainer(node: RR.Fiber | RR.StateNode | null, before: RR.StateNode, parent: RR.StateNode): void {
    var tag = (node as RR.Fiber).tag;
    if (5 === tag || 6 === tag)
      (node = (node as RR.Fiber).stateNode),
        before
          ? insertInContainerBefore!(parent, (node as RR.StateNode), before)
          : appendChildToContainer!(parent, (node as RR.StateNode));
    else if (
      4 !== tag &&
      (supportsSingletons &&
        27 === tag &&
        isSingletonScope!((node as RR.Fiber).type) &&
        ((parent = (node as RR.Fiber).stateNode), (before = null)),
      (node = (node as RR.Fiber).child),
      null !== node)
    )
      for (
        insertOrAppendPlacementNodeIntoContainer(node, before, parent),
          node = (node as RR.Fiber | null)!.sibling;
        null !== node;

      )
        insertOrAppendPlacementNodeIntoContainer(node, before, parent),
          (node = (node as RR.Fiber | null)!.sibling);
  }
  function insertOrAppendPlacementNode(node: RR.Fiber | RR.StateNode | null, before: RR.StateNode, parent: RR.StateNode): void {
    var tag = (node as RR.Fiber).tag;
    if (5 === tag || 6 === tag)
      (node = (node as RR.Fiber).stateNode),
        before ? insertBefore!(parent, (node as RR.StateNode), before) : appendChild!(parent, (node as RR.StateNode));
    else if (
      4 !== tag &&
      (supportsSingletons &&
        27 === tag &&
        isSingletonScope!((node as RR.Fiber).type) &&
        (parent = (node as RR.Fiber).stateNode),
      (node = (node as RR.Fiber).child),
      null !== node)
    )
      for (
        insertOrAppendPlacementNode(node, before, parent), node = (node as RR.Fiber | null)!.sibling;
        null !== node;

      )
        insertOrAppendPlacementNode(node, before, parent),
          (node = (node as RR.Fiber | null)!.sibling);
  }
  function commitHostPortalContainerChildren(
    portal: RR.PortalState | RR.Container,
    finishedWork: RR.Fiber,
    pendingChildren: RR.ChildSet | null
  ): void {
    portal = (portal as RR.PortalState).containerInfo;
    try {
      replaceContainerChildren!((portal as RR.Container), pendingChildren);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function commitHostSingletonAcquisition(finishedWork: RR.Fiber): void {
    var singleton = finishedWork.stateNode,
      props: RR.Props = finishedWork.memoizedProps;
    try {
      acquireSingletonInstance!(
        finishedWork.type,
        props,
        singleton,
        finishedWork
      );
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function commitBeforeMutationEffects(root: RR.FiberRoot, firstChild: RR.Fiber, committedLanes: RR.Lanes): void; function commitBeforeMutationEffects(root: RR.FiberRoot | RR.Fiber, firstChild: RR.Fiber | RR.Flags | RR.FunctionComponentUpdateQueue | RR.EventFunctionPayload[] | RR.ClassInstance["__reactInternalSnapshotBeforeUpdate"] | null): void {
    prepareForCommit((root as RR.FiberRoot).containerInfo);
    for (nextEffect = firstChild; null !== nextEffect; )
      if (
        ((root = nextEffect),
        (firstChild = root.child),
        0 !== (root.subtreeFlags & 1028) && null !== firstChild)
      )
        (firstChild!.return = root), (nextEffect = firstChild);
      else
        for (; null !== nextEffect; ) {
          root = nextEffect;
          var current: RR.Fiber | RR.MemoizedState | null = root.alternate;
          firstChild = root.flags;
          switch (root.tag) {
            case 0:
              if (
                0 !== (firstChild & 4) &&
                ((firstChild = root.updateQueue as RR.FunctionComponentUpdateQueue | null),
                (firstChild = null !== firstChild ? firstChild.events : null),
                null !== firstChild)
              )
                for (var ii: number | RR.Fiber = 0; ii < firstChild.length; ii++) {
                  var _eventPayloads$ii: RR.EventFunctionPayload | RR.Props = firstChild[ii];
                  (_eventPayloads$ii as RR.EventFunctionPayload).ref.impl = (_eventPayloads$ii as RR.EventFunctionPayload).nextImpl;
                }
              break;
            case 11:
            case 15:
              break;
            case 1:
              if (0 !== (firstChild & 1024) && null !== current) {
                firstChild = void 0;
                ii = root;
                _eventPayloads$ii = current.memoizedProps as RR.Props;
                current = current.memoizedState;
                var instance: RR.ClassInstance = ii.stateNode as RR.ClassInstance;
                try {
                  var resolvedPrevProps = resolveClassComponentProps(
                    ii.type as RR.ClassComponent,
                    _eventPayloads$ii
                  );
                  firstChild = instance.getSnapshotBeforeUpdate!(
                    resolvedPrevProps,
                    current
                  );
                  instance.__reactInternalSnapshotBeforeUpdate = firstChild;
                } catch (error) {
                  captureCommitPhaseError(ii, ii.return, error);
                }
              }
              break;
            case 3:
              0 !== (firstChild & 1024) &&
                supportsMutation &&
                clearContainer!((root.stateNode as RR.FiberRoot).containerInfo);
              break;
            case 5:
            case 26:
            case 27:
            case 6:
            case 4:
            case 17:
              break;
            default:
              if (0 !== (firstChild & 1024))
                throw Error(formatProdErrorMessage(163));
          }
          firstChild = root.sibling;
          if (null !== firstChild) {
            firstChild.return = root.return;
            nextEffect = firstChild;
            break;
          }
          nextEffect = root.return;
        }
  }
  function commitLayoutEffectOnFiber(finishedRoot: RR.FiberRoot | RR.ClassInstance | RR.StateNode | RR.ElementType, current: RR.Fiber | RR.MemoizedState | RR.Props | boolean | null, finishedWork: RR.Fiber | (() => void)): void {
    var flags: RR.Flags | RR.UpdateQueue | RR.SuspenseState | RR.SuspenseInstance | boolean | null = (finishedWork as RR.Fiber).flags;
    switch ((finishedWork as RR.Fiber).tag) {
      case 0:
      case 11:
      case 15:
        recursivelyTraverseLayoutEffects((finishedRoot as RR.FiberRoot), (finishedWork as RR.Fiber));
        (flags as RR.Flags) & 4 && commitHookEffectListMount(5, (finishedWork as RR.Fiber));
        break;
      case 1:
        recursivelyTraverseLayoutEffects((finishedRoot as RR.FiberRoot), (finishedWork as RR.Fiber));
        if ((flags as RR.Flags) & 4)
          if (((finishedRoot = (finishedWork as RR.Fiber).stateNode as RR.ClassInstance), null === (current as RR.Fiber | null)))
            try {
              finishedRoot.componentDidMount!();
            } catch (error) {
              captureCommitPhaseError((finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return, error);
            }
          else {
            var prevProps: RR.Props | RR.StateNode | boolean = resolveClassComponentProps(
              (finishedWork as RR.Fiber).type as RR.ClassComponent,
              (current as RR.Fiber | null)!.memoizedProps
            );
            current = (current as RR.Fiber | null)!.memoizedState;
            try {
              finishedRoot.componentDidUpdate!(
                (prevProps as RR.Props),
                current,
                finishedRoot.__reactInternalSnapshotBeforeUpdate
              );
            } catch (error$123) {
              captureCommitPhaseError(
                (finishedWork as RR.Fiber),
                (finishedWork as RR.Fiber).return,
                error$123
              );
            }
          }
        (flags as RR.Flags) & 64 && commitClassCallbacks((finishedWork as RR.Fiber));
        (flags as RR.Flags) & 512 && safelyAttachRef((finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return);
        break;
      case 3:
        recursivelyTraverseLayoutEffects((finishedRoot as RR.FiberRoot), (finishedWork as RR.Fiber));
        if (
          (flags as RR.Flags) & 64 &&
          ((flags = (finishedWork as RR.Fiber).updateQueue as RR.UpdateQueue | null), null !== flags)
        ) {
          finishedRoot = null;
          if (null !== (finishedWork as RR.Fiber).child)
            switch ((finishedWork as RR.Fiber).child!.tag) {
              case 27:
              case 5:
                finishedRoot = getPublicInstance((finishedWork as RR.Fiber).child!.stateNode);
                break;
              case 1:
                finishedRoot = (finishedWork as RR.Fiber).child!.stateNode;
            }
          try {
            commitCallbacks(flags, (finishedRoot as RR.StateNode));
          } catch (error) {
            captureCommitPhaseError((finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return, error);
          }
        }
        break;
      case 27:
        supportsSingletons &&
          null === (current as RR.Fiber | null) &&
          (flags as RR.Flags) & 4 &&
          commitHostSingletonAcquisition((finishedWork as RR.Fiber));
      case 26:
      case 5:
        recursivelyTraverseLayoutEffects((finishedRoot as RR.FiberRoot), (finishedWork as RR.Fiber));
        if (null === (current as RR.Fiber | null))
          if ((flags as RR.Flags) & 4) commitHostMount((finishedWork as RR.Fiber));
          else if ((flags as RR.Flags) & 64) {
            finishedRoot = (finishedWork as RR.Fiber).type;
            current = (finishedWork as RR.Fiber).memoizedProps;
            prevProps = (finishedWork as RR.Fiber).stateNode;
            try {
              commitHydratedInstance!(
                (prevProps as RR.StateNode),
                finishedRoot,
                (current as RR.Props),
                (finishedWork as RR.Fiber)
              );
            } catch (error) {
              captureCommitPhaseError((finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return, error);
            }
          }
        (flags as RR.Flags) & 512 && safelyAttachRef((finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return);
        break;
      case 12:
        recursivelyTraverseLayoutEffects((finishedRoot as RR.FiberRoot), (finishedWork as RR.Fiber));
        break;
      case 31:
        recursivelyTraverseLayoutEffects((finishedRoot as RR.FiberRoot), (finishedWork as RR.Fiber));
        (flags as RR.Flags) & 4 &&
          commitActivityHydrationCallbacks((finishedRoot as RR.FiberRoot), (finishedWork as RR.Fiber));
        break;
      case 13:
        recursivelyTraverseLayoutEffects((finishedRoot as RR.FiberRoot), (finishedWork as RR.Fiber));
        (flags as RR.Flags) & 4 &&
          commitSuspenseHydrationCallbacks((finishedRoot as RR.FiberRoot), (finishedWork as RR.Fiber));
        (flags as RR.Flags) & 64 &&
          ((flags = (finishedWork as RR.Fiber).memoizedState as RR.SuspenseState | null),
          null !== flags &&
            ((flags = flags.dehydrated),
            null !== flags &&
              ((finishedWork = retryDehydratedSuspenseBoundary.bind(
                null,
                (finishedWork as RR.Fiber)
              )),
              registerSuspenseInstanceRetry!(flags, finishedWork))));
        break;
      case 22:
        flags = null !== (finishedWork as RR.Fiber).memoizedState || offscreenSubtreeIsHidden;
        if (!flags) {
          current =
            (null !== (current as RR.Fiber | null) && null !== (current as RR.Fiber | null)!.memoizedState) ||
            offscreenSubtreeWasHidden;
          prevProps = offscreenSubtreeIsHidden;
          var prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
          offscreenSubtreeIsHidden = flags;
          (offscreenSubtreeWasHidden = current) &&
          !prevOffscreenSubtreeWasHidden
            ? recursivelyTraverseReappearLayoutEffects(
                (finishedRoot as RR.FiberRoot),
                (finishedWork as RR.Fiber),
                0 !== ((finishedWork as RR.Fiber).subtreeFlags & 8772)
              )
            : recursivelyTraverseLayoutEffects((finishedRoot as RR.FiberRoot), (finishedWork as RR.Fiber));
          offscreenSubtreeIsHidden = prevProps;
          offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
        }
        break;
      case 30:
        break;
      default:
        recursivelyTraverseLayoutEffects((finishedRoot as RR.FiberRoot), (finishedWork as RR.Fiber));
    }
  }
  function detachFiberAfterEffects(fiber: RR.Fiber): void {
    var alternate: RR.Fiber | RR.StateNode | null = fiber.alternate;
    null !== alternate &&
      ((fiber.alternate = null), detachFiberAfterEffects(alternate));
    fiber.child = null;
    fiber.deletions = null;
    fiber.sibling = null;
    5 === fiber.tag &&
      ((alternate = fiber.stateNode),
      null !== alternate && detachDeletedInstance(alternate));
    fiber.stateNode = null;
    fiber.return = null;
    fiber.dependencies = null;
    fiber.memoizedProps = null;
    fiber.memoizedState = null;
    fiber.pendingProps = null;
    fiber.stateNode = null;
    fiber.updateQueue = null;
  }
  function recursivelyTraverseDeletionEffects(
    finishedRoot: RR.FiberRoot,
    nearestMountedAncestor: RR.Fiber,
    parent: RR.Fiber | null
  ): void {
    for (parent = parent!.child; null !== parent; )
      commitDeletionEffectsOnFiber(
        finishedRoot,
        nearestMountedAncestor,
        parent
      ),
        (parent = parent.sibling);
  }
  function commitDeletionEffectsOnFiber(
    finishedRoot: RR.FiberRoot,
    nearestMountedAncestor: RR.Fiber,
    deletedFiber: RR.Fiber
  ): void {
    if (injectedHook && "function" === typeof injectedHook.onCommitFiberUnmount)
      try {
        injectedHook.onCommitFiberUnmount(rendererID, deletedFiber);
      } catch (err) {}
    switch (deletedFiber.tag) {
      case 26:
        if (supportsResources) {
          offscreenSubtreeWasHidden ||
            safelyDetachRef(deletedFiber, nearestMountedAncestor);
          recursivelyTraverseDeletionEffects(
            finishedRoot,
            nearestMountedAncestor,
            deletedFiber
          );
          deletedFiber.memoizedState
            ? releaseResource!(deletedFiber.memoizedState)
            : deletedFiber.stateNode &&
              unmountHoistable!(deletedFiber.stateNode);
          break;
        }
      case 27:
        if (supportsSingletons) {
          offscreenSubtreeWasHidden ||
            safelyDetachRef(deletedFiber, nearestMountedAncestor);
          var prevHostParent: RR.StateNode | RR.ClassInstance | boolean = hostParent,
            prevHostParentIsContainer: boolean = hostParentIsContainer;
          isSingletonScope!(deletedFiber.type) &&
            ((hostParent = deletedFiber.stateNode),
            (hostParentIsContainer = !1));
          recursivelyTraverseDeletionEffects(
            finishedRoot,
            nearestMountedAncestor,
            deletedFiber
          );
          releaseSingletonInstance!(deletedFiber.stateNode);
          hostParent = prevHostParent;
          hostParentIsContainer = prevHostParentIsContainer;
          break;
        }
      case 5:
        offscreenSubtreeWasHidden ||
          safelyDetachRef(deletedFiber, nearestMountedAncestor);
      case 6:
        if (supportsMutation) {
          if (
            ((prevHostParent = hostParent),
            (prevHostParentIsContainer = hostParentIsContainer),
            (hostParent = null),
            recursivelyTraverseDeletionEffects(
              finishedRoot,
              nearestMountedAncestor,
              deletedFiber
            ),
            (hostParent = prevHostParent),
            (hostParentIsContainer = prevHostParentIsContainer),
            null !== hostParent)
          )
            if (hostParentIsContainer)
              try {
                removeChildFromContainer!(hostParent, deletedFiber.stateNode);
              } catch (error) {
                captureCommitPhaseError(
                  deletedFiber,
                  nearestMountedAncestor,
                  error
                );
              }
            else
              try {
                removeChild!(hostParent, deletedFiber.stateNode);
              } catch (error) {
                captureCommitPhaseError(
                  deletedFiber,
                  nearestMountedAncestor,
                  error
                );
              }
        } else
          recursivelyTraverseDeletionEffects(
            finishedRoot,
            nearestMountedAncestor,
            deletedFiber
          );
        break;
      case 18:
        supportsMutation &&
          null !== hostParent &&
          (hostParentIsContainer
            ? clearSuspenseBoundaryFromContainer!(
                hostParent,
                deletedFiber.stateNode
              )
            : clearSuspenseBoundary!(hostParent, deletedFiber.stateNode));
        break;
      case 4:
        supportsMutation
          ? ((prevHostParent = hostParent),
            (prevHostParentIsContainer = hostParentIsContainer),
            (hostParent = (deletedFiber.stateNode as RR.PortalState).containerInfo),
            (hostParentIsContainer = !0),
            recursivelyTraverseDeletionEffects(
              finishedRoot,
              nearestMountedAncestor,
              deletedFiber
            ),
            (hostParent = prevHostParent),
            (hostParentIsContainer = prevHostParentIsContainer))
          : (supportsPersistence &&
              commitHostPortalContainerChildren(
                deletedFiber.stateNode as RR.PortalState,
                deletedFiber,
                createContainerChildSet!()
              ),
            recursivelyTraverseDeletionEffects(
              finishedRoot,
              nearestMountedAncestor,
              deletedFiber
            ));
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        commitHookEffectListUnmount(2, deletedFiber, nearestMountedAncestor);
        offscreenSubtreeWasHidden ||
          commitHookEffectListUnmount(4, deletedFiber, nearestMountedAncestor);
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber
        );
        break;
      case 1:
        offscreenSubtreeWasHidden ||
          (safelyDetachRef(deletedFiber, nearestMountedAncestor),
          (prevHostParent = deletedFiber.stateNode as RR.ClassInstance),
          "function" === typeof prevHostParent.componentWillUnmount &&
            safelyCallComponentWillUnmount(
              deletedFiber,
              nearestMountedAncestor,
              prevHostParent
            ));
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber
        );
        break;
      case 21:
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber
        );
        break;
      case 22:
        offscreenSubtreeWasHidden =
          (prevHostParent = offscreenSubtreeWasHidden) ||
          null !== deletedFiber.memoizedState;
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber
        );
        offscreenSubtreeWasHidden = prevHostParent;
        break;
      default:
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber
        );
    }
  }
  function commitActivityHydrationCallbacks(finishedRoot: RR.FiberRoot | RR.ActivityInstance | RR.Fiber | RR.SuspenseState | null, finishedWork: RR.Fiber): void {
    if (
      supportsHydration &&
      null === finishedWork.memoizedState &&
      ((finishedRoot = finishedWork.alternate),
      null !== finishedRoot &&
        ((finishedRoot = finishedRoot.memoizedState as RR.ActivityState | null), null !== finishedRoot))
    ) {
      finishedRoot = (finishedRoot as RR.ActivityState).dehydrated;
      try {
        commitHydratedActivityInstance!(finishedRoot);
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
    }
  }
  function commitSuspenseHydrationCallbacks(finishedRoot: RR.FiberRoot | RR.Fiber | RR.SuspenseState | RR.HostObject | null, finishedWork: RR.Fiber): void {
    if (
      supportsHydration &&
      null === finishedWork.memoizedState &&
      ((finishedRoot = finishedWork.alternate),
      null !== finishedRoot &&
        ((finishedRoot = finishedRoot.memoizedState as RR.SuspenseState | null),
        null !== finishedRoot &&
          ((finishedRoot = finishedRoot.dehydrated), null !== finishedRoot)))
    )
      try {
        commitHydratedSuspenseInstance!(finishedRoot as RR.SuspenseInstance);
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
  }
  function getRetryCache(finishedWork: RR.Fiber | RR.OffscreenInstance): RR.RetryCache {
    switch ((finishedWork as RR.Fiber).tag) {
      case 31:
      case 13:
      case 19:
        var retryCache: RR.RetryCache | null = (finishedWork as RR.Fiber).stateNode as RR.RetryCache | null;
        null === retryCache &&
          (retryCache = (finishedWork as RR.Fiber).stateNode = new PossiblyWeakSet());
        return retryCache!;
      case 22:
        return (
          (finishedWork = (finishedWork as RR.Fiber).stateNode as RR.OffscreenInstance),
          (retryCache = finishedWork._retryCache),
          null === retryCache &&
            (retryCache = finishedWork._retryCache = new PossiblyWeakSet()),
          retryCache!
        );
      default:
        throw Error(formatProdErrorMessage(435, (finishedWork as RR.Fiber).tag));
    }
  }
  function attachSuspenseRetryListeners(finishedWork: RR.Fiber, wakeables: RR.RetryQueue): void {
    var retryCache = getRetryCache(finishedWork);
    wakeables.forEach(function (wakeable) {
      if (!retryCache.has(wakeable)) {
        retryCache.add(wakeable);
        var retry: () => void = resolveRetryWakeable.bind(null, finishedWork, wakeable);
        wakeable.then(retry, retry);
      }
    });
  }
  function recursivelyTraverseMutationEffects(root$jscomp$0: RR.FiberRoot, parentFiber: RR.Fiber | null): void {
    var deletions = parentFiber!.deletions;
    if (null !== deletions)
      for (var i = 0; i < deletions.length; i++) {
        var childToDelete: RR.Fiber = deletions[i]!,
          root: RR.FiberRoot | RR.Fiber | null = root$jscomp$0,
          returnFiber: RR.Fiber = (parentFiber as RR.Fiber);
        if (supportsMutation) {
          var parent: RR.Fiber | null = returnFiber;
          a: for (; null !== parent; ) {
            switch (parent.tag) {
              case 27:
                if (supportsSingletons) {
                  if (isSingletonScope!(parent.type)) {
                    hostParent = parent.stateNode;
                    hostParentIsContainer = !1;
                    break a;
                  }
                  break;
                }
              case 5:
                hostParent = parent.stateNode;
                hostParentIsContainer = !1;
                break a;
              case 3:
              case 4:
                hostParent = (parent.stateNode as RR.FiberRoot | RR.PortalState).containerInfo;
                hostParentIsContainer = !0;
                break a;
            }
            parent = parent.return;
          }
          if (null === hostParent) throw Error(formatProdErrorMessage(160));
          commitDeletionEffectsOnFiber(root, returnFiber, childToDelete);
          hostParent = null;
          hostParentIsContainer = !1;
        } else commitDeletionEffectsOnFiber(root, returnFiber, childToDelete);
        root = childToDelete.alternate;
        null !== root && (root.return = null);
        childToDelete.return = null;
      }
    if (parentFiber!.subtreeFlags & 13886)
      for (parentFiber = parentFiber!.child; null !== parentFiber; )
        commitMutationEffectsOnFiber(parentFiber, root$jscomp$0),
          (parentFiber = parentFiber.sibling);
  }
  function commitMutationEffectsOnFiber(finishedWork: RR.Fiber | RR.UpdateQueue | null, root: RR.FiberRoot | RR.OffscreenInstance | RR.Fiber): void {
    var current: RR.Fiber | RR.UpdateCallback[] | string | RR.ChildSet | RR.HoistableRoot | RR.RetryQueue | null = (finishedWork as RR.Fiber).alternate,
      flags: RR.Flags | RR.UpdateCallback[] | RR.MemoizedState | string | RR.Container | RR.RetryQueue | RR.OffscreenQueue | null = (finishedWork as RR.Fiber).flags;
    switch ((finishedWork as RR.Fiber).tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
        commitReconciliationEffects((finishedWork as RR.Fiber));
        (flags as RR.Flags) & 4 &&
          (commitHookEffectListUnmount(3, (finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return),
          commitHookEffectListMount(3, (finishedWork as RR.Fiber)),
          commitHookEffectListUnmount(5, (finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return));
        break;
      case 1:
        recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
        commitReconciliationEffects((finishedWork as RR.Fiber));
        (flags as RR.Flags) & 512 &&
          (offscreenSubtreeWasHidden ||
            null === current ||
            safelyDetachRef((current as RR.Fiber | null), (current as RR.Fiber | null)!.return));
        (flags as RR.Flags) & 64 &&
          offscreenSubtreeIsHidden &&
          ((finishedWork = (finishedWork as RR.Fiber).updateQueue as RR.UpdateQueue | null),
          null !== finishedWork &&
            ((flags = finishedWork.callbacks),
            null !== flags &&
              ((current = finishedWork.shared.hiddenCallbacks),
              (finishedWork.shared.hiddenCallbacks =
                null === current ? flags : current.concat(flags)))));
        break;
      case 26:
        if (supportsResources) {
          var hoistableRoot: RR.HoistableRoot | RR.StateNode | RR.Props | boolean | null = currentHoistableRoot;
          recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
          commitReconciliationEffects((finishedWork as RR.Fiber));
          (flags as RR.Flags) & 512 &&
            (offscreenSubtreeWasHidden ||
              null === current ||
              safelyDetachRef((current as RR.Fiber | null), (current as RR.Fiber | null)!.return));
          if ((flags as RR.Flags) & 4) {
            flags = null !== current ? (current as RR.Fiber | null)!.memoizedState : null;
            var newResource: RR.MemoizedState | RR.StateNode = (finishedWork as RR.Fiber).memoizedState;
            null === current
              ? null === newResource
                ? null === (finishedWork as RR.Fiber).stateNode
                  ? ((finishedWork as RR.Fiber).stateNode = hydrateHoistable!(
                      hoistableRoot,
                      (finishedWork as RR.Fiber).type,
                      (finishedWork as RR.Fiber).memoizedProps,
                      (finishedWork as RR.Fiber)
                    ))
                  : mountHoistable!(
                      hoistableRoot,
                      (finishedWork as RR.Fiber).type,
                      (finishedWork as RR.Fiber).stateNode
                    )
                : ((finishedWork as RR.Fiber).stateNode = acquireResource!(
                    hoistableRoot,
                    (newResource as RR.MemoizedState),
                    (finishedWork as RR.Fiber).memoizedProps
                  ))
              : flags !== newResource
                ? (null === flags
                    ? null !== (current as RR.Fiber | null)!.stateNode &&
                      unmountHoistable!((current as RR.Fiber | null)!.stateNode)
                    : releaseResource!((flags as RR.MemoizedState)),
                  null === newResource
                    ? mountHoistable!(
                        hoistableRoot,
                        (finishedWork as RR.Fiber).type,
                        (finishedWork as RR.Fiber).stateNode
                      )
                    : acquireResource!(
                        hoistableRoot,
                        (newResource as RR.MemoizedState),
                        (finishedWork as RR.Fiber).memoizedProps
                      ))
                : null === newResource &&
                  null !== (finishedWork as RR.Fiber).stateNode &&
                  commitHostUpdate(
                    (finishedWork as RR.Fiber),
                    (finishedWork as RR.Fiber).memoizedProps,
                    (current as RR.Fiber | null)!.memoizedProps
                  );
          }
          break;
        }
      case 27:
        if (supportsSingletons) {
          recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
          commitReconciliationEffects((finishedWork as RR.Fiber));
          (flags as RR.Flags) & 512 &&
            (offscreenSubtreeWasHidden ||
              null === current ||
              safelyDetachRef((current as RR.Fiber | null), (current as RR.Fiber | null)!.return));
          null !== current &&
            (flags as RR.Flags) & 4 &&
            commitHostUpdate(
              (finishedWork as RR.Fiber),
              (finishedWork as RR.Fiber).memoizedProps,
              (current as RR.Fiber | null)!.memoizedProps
            );
          break;
        }
      case 5:
        recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
        commitReconciliationEffects((finishedWork as RR.Fiber));
        (flags as RR.Flags) & 512 &&
          (offscreenSubtreeWasHidden ||
            null === current ||
            safelyDetachRef((current as RR.Fiber | null), (current as RR.Fiber | null)!.return));
        if (supportsMutation) {
          if ((finishedWork as RR.Fiber).flags & 32) {
            hoistableRoot = (finishedWork as RR.Fiber).stateNode;
            try {
              resetTextContent!((hoistableRoot as RR.StateNode));
            } catch (error) {
              captureCommitPhaseError((finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return, error);
            }
          }
          (flags as RR.Flags) & 4 &&
            null != (finishedWork as RR.Fiber).stateNode &&
            ((hoistableRoot = (finishedWork as RR.Fiber).memoizedProps),
            commitHostUpdate(
              (finishedWork as RR.Fiber),
              (hoistableRoot as RR.Props),
              null !== current ? (current as RR.Fiber | null)!.memoizedProps : (hoistableRoot as RR.Props)
            ));
          (flags as RR.Flags) & 1024 && (needsFormReset = !0);
        } else
          supportsPersistence &&
            null !== (finishedWork as RR.Fiber).alternate &&
            ((finishedWork as RR.Fiber).alternate!.stateNode = (finishedWork as RR.Fiber).stateNode);
        break;
      case 6:
        recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
        commitReconciliationEffects((finishedWork as RR.Fiber));
        if ((flags as RR.Flags) & 4 && supportsMutation) {
          if (null === (finishedWork as RR.Fiber).stateNode)
            throw Error(formatProdErrorMessage(162));
          flags = (finishedWork as RR.Fiber).memoizedProps as string;
          current = (null !== current ? (current as RR.Fiber | null)!.memoizedProps : flags) as string;
          hoistableRoot = (finishedWork as RR.Fiber).stateNode;
          try {
            commitTextUpdate!((hoistableRoot as RR.StateNode), current, flags);
          } catch (error) {
            captureCommitPhaseError((finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return, error);
          }
        }
        break;
      case 3:
        supportsResources
          ? (prepareToCommitHoistables!(),
            (hoistableRoot = currentHoistableRoot),
            (currentHoistableRoot = getHoistableRoot!((root as RR.FiberRoot).containerInfo)),
            recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber)),
            (currentHoistableRoot = hoistableRoot))
          : recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
        commitReconciliationEffects((finishedWork as RR.Fiber));
        if ((flags as RR.Flags) & 4) {
          if (
            supportsMutation &&
            supportsHydration &&
            null !== current &&
            ((current as RR.Fiber | null)!.memoizedState as RR.RootState).isDehydrated
          )
            try {
              commitHydratedContainer!((root as RR.FiberRoot).containerInfo);
            } catch (error) {
              captureCommitPhaseError((finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return, error);
            }
          if (supportsPersistence) {
            flags = (root as RR.FiberRoot).containerInfo;
            current = (root as RR.FiberRoot).pendingChildren;
            try {
              replaceContainerChildren!((flags as RR.Container), current);
            } catch (error) {
              captureCommitPhaseError((finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return, error);
            }
          }
        }
        needsFormReset &&
          ((needsFormReset = !1), recursivelyResetForms((finishedWork as RR.Fiber)));
        break;
      case 4:
        supportsResources
          ? ((current = currentHoistableRoot),
            (currentHoistableRoot = getHoistableRoot!(
              ((finishedWork as RR.Fiber).stateNode as RR.PortalState).containerInfo
            )),
            recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber)),
            commitReconciliationEffects((finishedWork as RR.Fiber)),
            (currentHoistableRoot = current))
          : (recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber)),
            commitReconciliationEffects((finishedWork as RR.Fiber)));
        (flags as RR.Flags) & 4 &&
          supportsPersistence &&
          commitHostPortalContainerChildren(
            (finishedWork as RR.Fiber).stateNode as RR.PortalState,
            (finishedWork as RR.Fiber),
            ((finishedWork as RR.Fiber).stateNode as RR.PortalState).pendingChildren
          );
        break;
      case 12:
        recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
        commitReconciliationEffects((finishedWork as RR.Fiber));
        break;
      case 31:
        recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
        commitReconciliationEffects((finishedWork as RR.Fiber));
        (flags as RR.Flags) & 4 &&
          ((flags = (finishedWork as RR.Fiber).updateQueue as RR.RetryQueue | null),
          null !== flags &&
            (((finishedWork as RR.Fiber).updateQueue = null),
            attachSuspenseRetryListeners((finishedWork as RR.Fiber), flags)));
        break;
      case 13:
        recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
        commitReconciliationEffects((finishedWork as RR.Fiber));
        (finishedWork as RR.Fiber).child!.flags & 8192 &&
          (null !== (finishedWork as RR.Fiber).memoizedState) !==
            (null !== current && null !== (current as RR.Fiber | null)!.memoizedState) &&
          (globalMostRecentFallbackTime = now());
        (flags as RR.Flags) & 4 &&
          ((flags = (finishedWork as RR.Fiber).updateQueue as RR.RetryQueue | null),
          null !== flags &&
            (((finishedWork as RR.Fiber).updateQueue = null),
            attachSuspenseRetryListeners((finishedWork as RR.Fiber), flags)));
        break;
      case 22:
        hoistableRoot = null !== (finishedWork as RR.Fiber).memoizedState;
        var wasHidden: boolean | RR.Fiber = null !== current && null !== (current as RR.Fiber | null)!.memoizedState,
          prevOffscreenSubtreeIsHidden = offscreenSubtreeIsHidden,
          prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
        offscreenSubtreeIsHidden =
          prevOffscreenSubtreeIsHidden || hoistableRoot;
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden || wasHidden;
        recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
        offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden;
        commitReconciliationEffects((finishedWork as RR.Fiber));
        if (
          (flags as RR.Flags) & 8192 &&
          ((root = (finishedWork as RR.Fiber).stateNode as RR.OffscreenInstance),
          (root._visibility = hoistableRoot
            ? root._visibility & -2
            : root._visibility | 1),
          hoistableRoot &&
            (null === current ||
              wasHidden ||
              offscreenSubtreeIsHidden ||
              offscreenSubtreeWasHidden ||
              recursivelyTraverseDisappearLayoutEffects((finishedWork as RR.Fiber))),
          supportsMutation)
        )
          a: if (((current = null), supportsMutation))
            for (root = (finishedWork as RR.Fiber); ; ) {
              if (5 === (root as RR.Fiber).tag || (supportsResources && 26 === (root as RR.Fiber).tag)) {
                if (null === current) {
                  wasHidden = current = (root as RR.Fiber);
                  try {
                    (newResource = (wasHidden as RR.Fiber).stateNode),
                      hoistableRoot
                        ? hideInstance!((newResource as RR.StateNode))
                        : unhideInstance!(
                            (wasHidden as RR.Fiber).stateNode,
                            (wasHidden as RR.Fiber).memoizedProps
                          );
                  } catch (error) {
                    captureCommitPhaseError((wasHidden as RR.Fiber), (wasHidden as RR.Fiber).return, error);
                  }
                }
              } else if (6 === (root as RR.Fiber).tag) {
                if (null === current) {
                  wasHidden = (root as RR.Fiber);
                  try {
                    var instance = (wasHidden as RR.Fiber).stateNode;
                    hoistableRoot
                      ? hideTextInstance!(instance)
                      : unhideTextInstance!(instance, (wasHidden as RR.Fiber).memoizedProps);
                  } catch (error) {
                    captureCommitPhaseError((wasHidden as RR.Fiber), (wasHidden as RR.Fiber).return, error);
                  }
                }
              } else if (18 === (root as RR.Fiber).tag) {
                if (null === current) {
                  wasHidden = (root as RR.Fiber);
                  try {
                    var instance$jscomp$0 = (wasHidden as RR.Fiber).stateNode;
                    hoistableRoot
                      ? hideDehydratedBoundary!(instance$jscomp$0)
                      : unhideDehydratedBoundary!((wasHidden as RR.Fiber).stateNode);
                  } catch (error) {
                    captureCommitPhaseError((wasHidden as RR.Fiber), (wasHidden as RR.Fiber).return, error);
                  }
                }
              } else if (
                ((22 !== (root as RR.Fiber).tag && 23 !== (root as RR.Fiber).tag) ||
                  null === (root as RR.Fiber).memoizedState ||
                  root === (finishedWork as RR.Fiber)) &&
                null !== (root as RR.Fiber).child
              ) {
                (root as RR.Fiber).child!.return = root;
                root = (root as RR.Fiber).child!;
                continue;
              }
              if (root === (finishedWork as RR.Fiber)) break a;
              for (; null === (root as RR.Fiber).sibling; ) {
                if (null === (root as RR.Fiber).return || (root as RR.Fiber).return === (finishedWork as RR.Fiber))
                  break a;
                current === root && (current = null);
                root = (root as RR.Fiber).return!;
              }
              current === root && (current = null);
              (root as RR.Fiber).sibling!.return = (root as RR.Fiber).return;
              root = (root as RR.Fiber).sibling!;
            }
        (flags as RR.Flags) & 4 &&
          ((flags = (finishedWork as RR.Fiber).updateQueue as RR.OffscreenQueue | null),
          null !== flags &&
            ((current = flags.retryQueue),
            null !== current &&
              ((flags.retryQueue = null),
              attachSuspenseRetryListeners((finishedWork as RR.Fiber), current))));
        break;
      case 19:
        recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber));
        commitReconciliationEffects((finishedWork as RR.Fiber));
        (flags as RR.Flags) & 4 &&
          ((flags = (finishedWork as RR.Fiber).updateQueue as RR.RetryQueue | null),
          null !== flags &&
            (((finishedWork as RR.Fiber).updateQueue = null),
            attachSuspenseRetryListeners((finishedWork as RR.Fiber), flags)));
        break;
      case 30:
        break;
      case 21:
        break;
      default:
        recursivelyTraverseMutationEffects((root as RR.FiberRoot), (finishedWork as RR.Fiber)),
          commitReconciliationEffects((finishedWork as RR.Fiber));
    }
  }
  function commitReconciliationEffects(finishedWork: RR.Fiber): void {
    var flags = finishedWork.flags;
    if (flags & 2) {
      try {
        for (
          var hostParentFiber: RR.Fiber | undefined, parentFiber = finishedWork.return;
          null !== parentFiber;

        ) {
          if (isHostParent(parentFiber)) {
            hostParentFiber = parentFiber;
            break;
          }
          parentFiber = parentFiber.return;
        }
        if (supportsMutation) {
          if (null == hostParentFiber) throw Error(formatProdErrorMessage(160));
          switch (hostParentFiber.tag) {
            case 27:
              if (supportsSingletons) {
                var parent = hostParentFiber.stateNode,
                  before = getHostSibling(finishedWork);
                insertOrAppendPlacementNode(finishedWork, before, parent);
                break;
              }
            case 5:
              var parent$125 = hostParentFiber.stateNode;
              hostParentFiber.flags & 32 &&
                (resetTextContent!(parent$125), (hostParentFiber.flags &= -33));
              var before$126 = getHostSibling(finishedWork);
              insertOrAppendPlacementNode(finishedWork, before$126, parent$125);
              break;
            case 3:
            case 4:
              var parent$127 = (hostParentFiber.stateNode as RR.FiberRoot | RR.PortalState).containerInfo,
                before$128 = getHostSibling(finishedWork);
              insertOrAppendPlacementNodeIntoContainer(
                finishedWork,
                before$128,
                parent$127
              );
              break;
            default:
              throw Error(formatProdErrorMessage(161));
          }
        }
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
      finishedWork.flags &= -3;
    }
    flags & 4096 && (finishedWork.flags &= -4097);
  }
  function recursivelyResetForms(parentFiber: RR.Fiber | null): void {
    if (parentFiber!.subtreeFlags & 1024)
      for (parentFiber = parentFiber!.child; null !== parentFiber; ) {
        var fiber = parentFiber;
        recursivelyResetForms(fiber);
        5 === fiber.tag &&
          fiber.flags & 1024 &&
          resetFormInstance(fiber.stateNode);
        parentFiber = parentFiber.sibling;
      }
  }
  function recursivelyTraverseLayoutEffects(root: RR.FiberRoot, parentFiber: RR.Fiber | null): void {
    if (parentFiber!.subtreeFlags & 8772)
      for (parentFiber = parentFiber!.child; null !== parentFiber; )
        commitLayoutEffectOnFiber(root, parentFiber.alternate, parentFiber),
          (parentFiber = parentFiber.sibling);
  }
  function recursivelyTraverseDisappearLayoutEffects(parentFiber: RR.Fiber | null): void {
    for (parentFiber = parentFiber!.child; null !== parentFiber; ) {
      var finishedWork = parentFiber;
      switch (finishedWork.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          commitHookEffectListUnmount(4, finishedWork, finishedWork.return);
          recursivelyTraverseDisappearLayoutEffects(finishedWork);
          break;
        case 1:
          safelyDetachRef(finishedWork, finishedWork.return);
          var instance: RR.ClassInstance = finishedWork.stateNode as RR.ClassInstance;
          "function" === typeof instance.componentWillUnmount &&
            safelyCallComponentWillUnmount(
              finishedWork,
              finishedWork.return,
              instance
            );
          recursivelyTraverseDisappearLayoutEffects(finishedWork);
          break;
        case 27:
          supportsSingletons &&
            releaseSingletonInstance!(finishedWork.stateNode);
        case 26:
        case 5:
          safelyDetachRef(finishedWork, finishedWork.return);
          recursivelyTraverseDisappearLayoutEffects(finishedWork);
          break;
        case 22:
          null === finishedWork.memoizedState &&
            recursivelyTraverseDisappearLayoutEffects(finishedWork);
          break;
        case 30:
          recursivelyTraverseDisappearLayoutEffects(finishedWork);
          break;
        default:
          recursivelyTraverseDisappearLayoutEffects(finishedWork);
      }
      parentFiber = parentFiber.sibling;
    }
  }
  function recursivelyTraverseReappearLayoutEffects(
    finishedRoot$jscomp$0: RR.FiberRoot,
    parentFiber: RR.Fiber | null,
    includeWorkInProgressEffects: boolean
  ): void {
    includeWorkInProgressEffects =
      includeWorkInProgressEffects && 0 !== (parentFiber!.subtreeFlags & 8772);
    for (parentFiber = parentFiber!.child; null !== parentFiber; ) {
      var current: RR.Fiber | null = parentFiber.alternate,
        finishedRoot: RR.FiberRoot | RR.ClassInstance | RR.UpdateQueue | number | null = finishedRoot$jscomp$0,
        finishedWork = parentFiber,
        flags = finishedWork.flags;
      switch (finishedWork.tag) {
        case 0:
        case 11:
        case 15:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          commitHookEffectListMount(4, finishedWork);
          break;
        case 1:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          current = finishedWork;
          finishedRoot = current.stateNode as RR.ClassInstance;
          if ("function" === typeof finishedRoot.componentDidMount)
            try {
              (finishedRoot as RR.ClassInstance).componentDidMount!();
            } catch (error) {
              captureCommitPhaseError(current, current.return, error);
            }
          current = finishedWork;
          finishedRoot = current.updateQueue as RR.UpdateQueue | null;
          if (null !== finishedRoot) {
            var instance = current.stateNode;
            try {
              var hiddenCallbacks = finishedRoot.shared.hiddenCallbacks;
              if (null !== hiddenCallbacks)
                for (
                  finishedRoot.shared.hiddenCallbacks = null, finishedRoot = 0;
                  finishedRoot < hiddenCallbacks.length;
                  finishedRoot++
                )
                  callCallback(hiddenCallbacks[finishedRoot]!, instance);
            } catch (error) {
              captureCommitPhaseError(current, current.return, error);
            }
          }
          includeWorkInProgressEffects &&
            flags & 64 &&
            commitClassCallbacks(finishedWork);
          safelyAttachRef(finishedWork, finishedWork.return);
          break;
        case 27:
          supportsSingletons && commitHostSingletonAcquisition(finishedWork);
        case 26:
        case 5:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          includeWorkInProgressEffects &&
            null === current &&
            flags & 4 &&
            commitHostMount(finishedWork);
          safelyAttachRef(finishedWork, finishedWork.return);
          break;
        case 12:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          break;
        case 31:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          includeWorkInProgressEffects &&
            flags & 4 &&
            commitActivityHydrationCallbacks(finishedRoot, finishedWork);
          break;
        case 13:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          includeWorkInProgressEffects &&
            flags & 4 &&
            commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
          break;
        case 22:
          null === finishedWork.memoizedState &&
            recursivelyTraverseReappearLayoutEffects(
              finishedRoot,
              finishedWork,
              includeWorkInProgressEffects
            );
          safelyAttachRef(finishedWork, finishedWork.return);
          break;
        case 30:
          break;
        default:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
      }
      parentFiber = parentFiber.sibling;
    }
  }
  function commitOffscreenPassiveMountEffects(current: RR.Fiber | RR.Cache | null, finishedWork: RR.Fiber): void {
    var previousCache: RR.Cache | null = null;
    null !== (current as RR.Fiber | null) &&
      null !== (current as RR.Fiber | null)!.memoizedState &&
      null !== ((current as RR.Fiber | null)!.memoizedState as RR.OffscreenState).cachePool &&
      (previousCache = ((current as RR.Fiber | null)!.memoizedState as RR.OffscreenState).cachePool!.pool);
    current = null;
    null !== finishedWork.memoizedState &&
      null !== (finishedWork.memoizedState as RR.OffscreenState).cachePool &&
      (current = (finishedWork.memoizedState as RR.OffscreenState).cachePool!.pool);
    current !== previousCache &&
      (null != current && current.refCount++,
      null != previousCache && releaseCache(previousCache));
  }
  function commitCachePassiveMountEffect(current: RR.Fiber | RR.Cache | null, finishedWork: RR.Fiber | RR.Cache | null): void {
    current = null;
    null !== (finishedWork as RR.Fiber).alternate &&
      (current = ((finishedWork as RR.Fiber).alternate!.memoizedState as RR.CacheComponentState).cache);
    finishedWork = ((finishedWork as RR.Fiber).memoizedState as RR.CacheComponentState).cache;
    finishedWork !== current &&
      (finishedWork!.refCount++, null != current && releaseCache(current));
  }
  function recursivelyTraversePassiveMountEffects(
    root: RR.FiberRoot,
    parentFiber: RR.Fiber | null,
    committedLanes: RR.Lanes,
    committedTransitions: RR.Transition[] | null
  ): void {
    if (parentFiber!.subtreeFlags & 10256)
      for (parentFiber = parentFiber!.child; null !== parentFiber; )
        commitPassiveMountOnFiber(
          root,
          parentFiber,
          committedLanes,
          committedTransitions
        ),
          (parentFiber = parentFiber.sibling);
  }
  function commitPassiveMountOnFiber(
    finishedRoot: RR.FiberRoot | RR.Cache | RR.ProfilerState | null,
    finishedWork: RR.Fiber | RR.Cache,
    committedLanes: RR.Lanes,
    committedTransitions: RR.Transition[] | null
  ): void {
    var flags = (finishedWork as RR.Fiber).flags;
    switch ((finishedWork as RR.Fiber).tag) {
      case 0:
      case 11:
      case 15:
        recursivelyTraversePassiveMountEffects(
          (finishedRoot as RR.FiberRoot),
          (finishedWork as RR.Fiber),
          committedLanes,
          committedTransitions
        );
        flags & 2048 && commitHookEffectListMount(9, (finishedWork as RR.Fiber));
        break;
      case 1:
        recursivelyTraversePassiveMountEffects(
          (finishedRoot as RR.FiberRoot),
          (finishedWork as RR.Fiber),
          committedLanes,
          committedTransitions
        );
        break;
      case 3:
        recursivelyTraversePassiveMountEffects(
          (finishedRoot as RR.FiberRoot),
          (finishedWork as RR.Fiber),
          committedLanes,
          committedTransitions
        );
        flags & 2048 &&
          ((finishedRoot = null),
          null !== (finishedWork as RR.Fiber).alternate &&
            (finishedRoot = ((finishedWork as RR.Fiber).alternate!.memoizedState as RR.RootState).cache),
          (finishedWork = ((finishedWork as RR.Fiber).memoizedState as RR.RootState).cache),
          finishedWork !== finishedRoot &&
            (finishedWork.refCount++,
            null != finishedRoot && releaseCache(finishedRoot)));
        break;
      case 12:
        if (flags & 2048) {
          recursivelyTraversePassiveMountEffects(
            (finishedRoot as RR.FiberRoot),
            (finishedWork as RR.Fiber),
            committedLanes,
            committedTransitions
          );
          finishedRoot = (finishedWork as RR.Fiber).stateNode as RR.ProfilerState | null;
          try {
            var _finishedWork$memoize2: RR.ProfilerProps | RR.OffscreenInstance = (finishedWork as RR.Fiber).memoizedProps as RR.ProfilerProps,
              id: string | RR.Fiber | undefined | null = _finishedWork$memoize2.id,
              onPostCommit = _finishedWork$memoize2.onPostCommit;
            "function" === typeof onPostCommit &&
              onPostCommit(
                id,
                null === (finishedWork as RR.Fiber).alternate ? "mount" : "update",
                finishedRoot!.passiveEffectDuration,
                -0
              );
          } catch (error) {
            captureCommitPhaseError((finishedWork as RR.Fiber), (finishedWork as RR.Fiber).return, error);
          }
        } else
          recursivelyTraversePassiveMountEffects(
            (finishedRoot as RR.FiberRoot),
            (finishedWork as RR.Fiber),
            committedLanes,
            committedTransitions
          );
        break;
      case 31:
        recursivelyTraversePassiveMountEffects(
          (finishedRoot as RR.FiberRoot),
          (finishedWork as RR.Fiber),
          committedLanes,
          committedTransitions
        );
        break;
      case 13:
        recursivelyTraversePassiveMountEffects(
          (finishedRoot as RR.FiberRoot),
          (finishedWork as RR.Fiber),
          committedLanes,
          committedTransitions
        );
        break;
      case 23:
        break;
      case 22:
        _finishedWork$memoize2 = (finishedWork as RR.Fiber).stateNode as RR.OffscreenInstance;
        id = (finishedWork as RR.Fiber).alternate;
        null !== (finishedWork as RR.Fiber).memoizedState
          ? _finishedWork$memoize2._visibility & 2
            ? recursivelyTraversePassiveMountEffects(
                (finishedRoot as RR.FiberRoot),
                (finishedWork as RR.Fiber),
                committedLanes,
                committedTransitions
              )
            : recursivelyTraverseAtomicPassiveEffects(
                (finishedRoot as RR.FiberRoot),
                (finishedWork as RR.Fiber)
              )
          : _finishedWork$memoize2._visibility & 2
            ? recursivelyTraversePassiveMountEffects(
                (finishedRoot as RR.FiberRoot),
                (finishedWork as RR.Fiber),
                committedLanes,
                committedTransitions
              )
            : ((_finishedWork$memoize2._visibility |= 2),
              recursivelyTraverseReconnectPassiveEffects(
                (finishedRoot as RR.FiberRoot),
                (finishedWork as RR.Fiber),
                committedLanes,
                committedTransitions,
                0 !== ((finishedWork as RR.Fiber).subtreeFlags & 10256) || !1
              ));
        flags & 2048 && commitOffscreenPassiveMountEffects((id as RR.Fiber | null), (finishedWork as RR.Fiber));
        break;
      case 24:
        recursivelyTraversePassiveMountEffects(
          (finishedRoot as RR.FiberRoot),
          (finishedWork as RR.Fiber),
          committedLanes,
          committedTransitions
        );
        flags & 2048 &&
          commitCachePassiveMountEffect((finishedWork as RR.Fiber).alternate, (finishedWork as RR.Fiber));
        break;
      default:
        recursivelyTraversePassiveMountEffects(
          (finishedRoot as RR.FiberRoot),
          (finishedWork as RR.Fiber),
          committedLanes,
          committedTransitions
        );
    }
  }
  function recursivelyTraverseReconnectPassiveEffects(
    finishedRoot$jscomp$0: RR.FiberRoot,
    parentFiber: RR.Fiber | null,
    committedLanes$jscomp$0: RR.Lanes,
    committedTransitions$jscomp$0: RR.Transition[] | null,
    includeWorkInProgressEffects: boolean
  ): void {
    includeWorkInProgressEffects =
      includeWorkInProgressEffects &&
      (0 !== (parentFiber!.subtreeFlags & 10256) || !1);
    for (parentFiber = parentFiber!.child; null !== parentFiber; ) {
      var finishedRoot = finishedRoot$jscomp$0,
        finishedWork = parentFiber,
        committedLanes = committedLanes$jscomp$0,
        committedTransitions = committedTransitions$jscomp$0,
        flags = finishedWork.flags;
      switch (finishedWork.tag) {
        case 0:
        case 11:
        case 15:
          recursivelyTraverseReconnectPassiveEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            includeWorkInProgressEffects
          );
          commitHookEffectListMount(8, finishedWork);
          break;
        case 23:
          break;
        case 22:
          var instance: RR.OffscreenInstance = finishedWork.stateNode as RR.OffscreenInstance;
          null !== finishedWork.memoizedState
            ? instance._visibility & 2
              ? recursivelyTraverseReconnectPassiveEffects(
                  finishedRoot,
                  finishedWork,
                  committedLanes,
                  committedTransitions,
                  includeWorkInProgressEffects
                )
              : recursivelyTraverseAtomicPassiveEffects(
                  finishedRoot,
                  finishedWork
                )
            : ((instance._visibility |= 2),
              recursivelyTraverseReconnectPassiveEffects(
                finishedRoot,
                finishedWork,
                committedLanes,
                committedTransitions,
                includeWorkInProgressEffects
              ));
          includeWorkInProgressEffects &&
            flags & 2048 &&
            commitOffscreenPassiveMountEffects(
              finishedWork.alternate,
              finishedWork
            );
          break;
        case 24:
          recursivelyTraverseReconnectPassiveEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            includeWorkInProgressEffects
          );
          includeWorkInProgressEffects &&
            flags & 2048 &&
            commitCachePassiveMountEffect(finishedWork.alternate, finishedWork);
          break;
        default:
          recursivelyTraverseReconnectPassiveEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            includeWorkInProgressEffects
          );
      }
      parentFiber = parentFiber.sibling;
    }
  }
  function recursivelyTraverseAtomicPassiveEffects(
    finishedRoot$jscomp$0: RR.FiberRoot,
    parentFiber: RR.Fiber | null
  ): void {
    if (parentFiber!.subtreeFlags & 10256)
      for (parentFiber = parentFiber!.child; null !== parentFiber; ) {
        var finishedRoot: RR.FiberRoot = finishedRoot$jscomp$0,
          finishedWork: RR.Fiber = parentFiber,
          flags: RR.Flags = finishedWork.flags;
        switch (finishedWork.tag) {
          case 22:
            recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork);
            flags & 2048 &&
              commitOffscreenPassiveMountEffects(
                finishedWork.alternate,
                finishedWork
              );
            break;
          case 24:
            recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork);
            flags & 2048 &&
              commitCachePassiveMountEffect(
                finishedWork.alternate,
                finishedWork
              );
            break;
          default:
            recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork);
        }
        parentFiber = parentFiber.sibling;
      }
  }
  function recursivelyAccumulateSuspenseyCommit(
    parentFiber: RR.Fiber | null,
    committedLanes: RR.Lanes,
    suspendedState: RR.SuspendedState
  ): void {
    if (parentFiber!.subtreeFlags & suspenseyCommitFlag)
      for (parentFiber = parentFiber!.child; null !== parentFiber; )
        accumulateSuspenseyCommitOnFiber(
          parentFiber,
          committedLanes,
          suspendedState
        ),
          (parentFiber = parentFiber.sibling);
  }
  function accumulateSuspenseyCommitOnFiber(
    fiber: RR.Fiber | RR.Fiber["memoizedProps"],
    committedLanes: RR.Lanes,
    suspendedState: RR.SuspendedState
  ): void {
    switch (fiber.tag) {
      case 26:
        recursivelyAccumulateSuspenseyCommit(
          fiber,
          committedLanes,
          suspendedState
        );
        if (fiber.flags & suspenseyCommitFlag)
          if (null !== fiber.memoizedState)
            suspendResource!(
              suspendedState,
              currentHoistableRoot,
              fiber.memoizedState,
              fiber.memoizedProps
            );
          else {
            var instance: RR.StateNode | RR.HoistableRoot | RR.Fiber | RR.Flags | null = fiber.stateNode,
              type: RR.ElementType = fiber.type;
            fiber = fiber.memoizedProps;
            ((committedLanes & 335544128) === committedLanes ||
              maySuspendCommitInSyncRender!(type, fiber)) &&
              suspendInstance(suspendedState, (instance as RR.StateNode), type, fiber);
          }
        break;
      case 5:
        recursivelyAccumulateSuspenseyCommit(
          fiber,
          committedLanes,
          suspendedState
        );
        fiber.flags & suspenseyCommitFlag &&
          ((instance = fiber.stateNode),
          (type = fiber.type),
          (fiber = fiber.memoizedProps),
          ((committedLanes & 335544128) === committedLanes ||
            maySuspendCommitInSyncRender!(type, fiber)) &&
            suspendInstance(suspendedState, (instance as RR.StateNode), type, fiber));
        break;
      case 3:
      case 4:
        supportsResources
          ? ((instance = currentHoistableRoot),
            (currentHoistableRoot = getHoistableRoot!(
              (fiber.stateNode as RR.FiberRoot | RR.PortalState).containerInfo
            )),
            recursivelyAccumulateSuspenseyCommit(
              fiber,
              committedLanes,
              suspendedState
            ),
            (currentHoistableRoot = instance))
          : recursivelyAccumulateSuspenseyCommit(
              fiber,
              committedLanes,
              suspendedState
            );
        break;
      case 22:
        null === fiber.memoizedState &&
          ((instance = fiber.alternate),
          null !== (instance as RR.Fiber | null) && null !== (instance as RR.Fiber | null)!.memoizedState
            ? ((instance = suspenseyCommitFlag),
              (suspenseyCommitFlag = 16777216),
              recursivelyAccumulateSuspenseyCommit(
                fiber,
                committedLanes,
                suspendedState
              ),
              (suspenseyCommitFlag = instance))
            : recursivelyAccumulateSuspenseyCommit(
                fiber,
                committedLanes,
                suspendedState
              ));
        break;
      default:
        recursivelyAccumulateSuspenseyCommit(
          fiber,
          committedLanes,
          suspendedState
        );
    }
  }
  function detachAlternateSiblings(parentFiber: RR.Fiber | null): void {
    var previousFiber: RR.Fiber | null = parentFiber!.alternate;
    if (
      null !== previousFiber &&
      ((parentFiber = previousFiber.child), null !== parentFiber)
    ) {
      previousFiber.child = null;
      do
        (previousFiber = parentFiber.sibling),
          (parentFiber.sibling = null),
          (parentFiber = previousFiber);
      while (null !== parentFiber);
    }
  }
  function recursivelyTraversePassiveUnmountEffects(parentFiber: RR.Fiber | null): void {
    var deletions: RR.Fiber[] | null = parentFiber!.deletions;
    if (0 !== (parentFiber!.flags & 16)) {
      if (null !== deletions)
        for (var i = 0; i < deletions.length; i++) {
          var childToDelete: RR.Fiber = deletions[i]!;
          nextEffect = childToDelete;
          commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
            childToDelete,
            (parentFiber as RR.Fiber)
          );
        }
      detachAlternateSiblings(parentFiber!);
    }
    if (parentFiber!.subtreeFlags & 10256)
      for (parentFiber = parentFiber!.child; null !== parentFiber; )
        commitPassiveUnmountOnFiber(parentFiber),
          (parentFiber = parentFiber.sibling);
  }
  function commitPassiveUnmountOnFiber(finishedWork: RR.Fiber): void {
    switch (finishedWork.tag) {
      case 0:
      case 11:
      case 15:
        recursivelyTraversePassiveUnmountEffects(finishedWork);
        finishedWork.flags & 2048 &&
          commitHookEffectListUnmount(9, finishedWork, finishedWork.return);
        break;
      case 3:
        recursivelyTraversePassiveUnmountEffects(finishedWork);
        break;
      case 12:
        recursivelyTraversePassiveUnmountEffects(finishedWork);
        break;
      case 22:
        var instance: RR.OffscreenInstance = finishedWork.stateNode as RR.OffscreenInstance;
        null !== finishedWork.memoizedState &&
        instance._visibility & 2 &&
        (null === finishedWork.return || 13 !== finishedWork.return.tag)
          ? ((instance._visibility &= -3),
            recursivelyTraverseDisconnectPassiveEffects(finishedWork))
          : recursivelyTraversePassiveUnmountEffects(finishedWork);
        break;
      default:
        recursivelyTraversePassiveUnmountEffects(finishedWork);
    }
  }
  function recursivelyTraverseDisconnectPassiveEffects(parentFiber: RR.Fiber | null): void {
    var deletions: RR.Fiber[] | RR.Fiber | null = parentFiber!.deletions;
    if (0 !== (parentFiber!.flags & 16)) {
      if (null !== deletions)
        for (var i: number | RR.OffscreenInstance = 0; i < deletions.length; i++) {
          var childToDelete: RR.Fiber = deletions[i]!;
          nextEffect = childToDelete;
          commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
            childToDelete,
            (parentFiber as RR.Fiber)
          );
        }
      detachAlternateSiblings(parentFiber!);
    }
    for (parentFiber = parentFiber!.child; null !== parentFiber; ) {
      deletions = parentFiber;
      switch (deletions.tag) {
        case 0:
        case 11:
        case 15:
          commitHookEffectListUnmount(8, deletions, deletions.return);
          recursivelyTraverseDisconnectPassiveEffects(deletions);
          break;
        case 22:
          i = deletions.stateNode as RR.OffscreenInstance;
          i._visibility & 2 &&
            ((i._visibility &= -3),
            recursivelyTraverseDisconnectPassiveEffects(deletions));
          break;
        default:
          recursivelyTraverseDisconnectPassiveEffects(deletions);
      }
      parentFiber = parentFiber.sibling;
    }
  }
  function commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
    deletedSubtreeRoot: RR.Fiber,
    nearestMountedAncestor: RR.Fiber
  ): void {
    for (; null !== nextEffect; ) {
      var fiber: RR.Fiber = nextEffect;
      switch (fiber.tag) {
        case 0:
        case 11:
        case 15:
          commitHookEffectListUnmount(8, fiber, nearestMountedAncestor);
          break;
        case 23:
        case 22:
          if (
            null !== fiber.memoizedState &&
            null !== (fiber.memoizedState as RR.OffscreenState).cachePool
          ) {
            var cache: RR.Cache | RR.Fiber | null = (fiber.memoizedState as RR.OffscreenState).cachePool!.pool;
            null != cache && cache.refCount++;
          }
          break;
        case 24:
          releaseCache((fiber.memoizedState as RR.CacheComponentState).cache!);
      }
      cache = fiber.child;
      if (null !== cache) (cache.return = fiber), (nextEffect = cache);
      else
        a: for (fiber = deletedSubtreeRoot; null !== nextEffect; ) {
          cache = nextEffect;
          var sibling: RR.Fiber | null = cache.sibling,
            returnFiber: RR.Fiber | null = cache.return;
          detachFiberAfterEffects(cache);
          if (cache === fiber) {
            nextEffect = null;
            break a;
          }
          if (null !== sibling) {
            sibling.return = returnFiber;
            nextEffect = sibling;
            break a;
          }
          nextEffect = returnFiber;
        }
    }
  }
  function findFiberRootForHostRoot(hostRoot: RR.Instance | RR.Fiber | null): RR.Fiber {
    var maybeFiber: RR.Fiber | null | undefined = getInstanceFromNode((hostRoot as RR.Instance));
    if (null != maybeFiber) {
      if ("string" !== typeof maybeFiber.memoizedProps["data-testname"])
        throw Error(formatProdErrorMessage(364));
      return maybeFiber;
    }
    hostRoot = findFiberRoot!((hostRoot as RR.Instance));
    if (null === hostRoot) throw Error(formatProdErrorMessage(362));
    return (hostRoot.stateNode as RR.FiberRoot).current!;
  }
  function matchSelector(fiber$jscomp$0: RR.Fiber | (RR.Fiber | number)[] | string | unknown | null, selector: RR.Selector | RR.Selector[] | boolean): boolean {
    var tag: RR.WorkTag | number = (fiber$jscomp$0 as RR.Fiber).tag;
    switch ((selector as RR.Selector).$$typeof) {
      case COMPONENT_TYPE:
        if ((fiber$jscomp$0 as RR.Fiber).type === (selector as RR.Selector).value) return !0;
        break;
      case HAS_PSEUDO_CLASS_TYPE:
        a: {
          selector = (selector as RR.Selector).value as RR.Selector[];
          fiber$jscomp$0 = [(fiber$jscomp$0 as RR.Fiber), 0];
          for (tag = 0; tag < (fiber$jscomp$0 as (RR.Fiber | number)[]).length; ) {
            var fiber: RR.Fiber | null = (fiber$jscomp$0 as (RR.Fiber | number)[])[tag++] as RR.Fiber,
              tag$jscomp$0: RR.WorkTag = fiber.tag,
              selectorIndex: number = (fiber$jscomp$0 as (RR.Fiber | number)[])[tag++] as number,
              selector$jscomp$0: RR.Selector | undefined = selector[selectorIndex];
            if (
              (5 !== tag$jscomp$0 &&
                26 !== tag$jscomp$0 &&
                27 !== tag$jscomp$0) ||
              !isHiddenSubtree!(fiber)
            ) {
              for (
                ;
                null != selector$jscomp$0 &&
                matchSelector(fiber, selector$jscomp$0);

              )
                selectorIndex++, (selector$jscomp$0 = selector[selectorIndex]);
              if (selectorIndex === selector.length) {
                selector = !0;
                break a;
              } else
                for (fiber = fiber.child; null !== fiber; )
                  (fiber$jscomp$0 as (RR.Fiber | number)[]).push(fiber, selectorIndex),
                    (fiber = fiber.sibling);
            }
          }
          selector = !1;
        }
        return selector;
      case ROLE_TYPE:
        if (
          (5 === tag || 26 === tag || 27 === tag) &&
          matchAccessibilityRole!((fiber$jscomp$0 as RR.Fiber).stateNode, (selector as RR.Selector).value)
        )
          return !0;
        break;
      case TEXT_TYPE:
        if (5 === tag || 6 === tag || 26 === tag || 27 === tag)
          if (
            ((fiber$jscomp$0 = getTextContent!((fiber$jscomp$0 as RR.Fiber))),
            null !== (fiber$jscomp$0 as string | null) &&
              0 <= (fiber$jscomp$0 as string | null)!.indexOf((selector as RR.Selector).value))
          )
            return !0;
        break;
      case TEST_NAME_TYPE:
        if (5 === tag || 26 === tag || 27 === tag)
          if (
            ((fiber$jscomp$0 = (fiber$jscomp$0 as RR.Fiber).memoizedProps["data-testname"]),
            "string" === typeof fiber$jscomp$0 &&
              fiber$jscomp$0.toLowerCase() === (selector as RR.Selector).value.toLowerCase())
          )
            return !0;
        break;
      default:
        throw Error(formatProdErrorMessage(365));
    }
    return !1;
  }
  function selectorToString(selector: RR.Selector): string {
    switch (selector.$$typeof) {
      case COMPONENT_TYPE:
        return (
          "<" + (getComponentNameFromType(selector.value) || "Unknown") + ">"
        );
      case HAS_PSEUDO_CLASS_TYPE:
        return ":has(" + (selectorToString(selector) || "") + ")";
      case ROLE_TYPE:
        return '[role="' + selector.value + '"]';
      case TEXT_TYPE:
        return '"' + selector.value + '"';
      case TEST_NAME_TYPE:
        return '[data-testname="' + selector.value + '"]';
      default:
        throw Error(formatProdErrorMessage(365));
    }
  }
  function findPaths(root: RR.Fiber | (RR.Fiber | number)[], selectors: RR.Selector[]): RR.Fiber[] {
    var matchingFibers: RR.Fiber[] = [];
    root = [(root as RR.Fiber), 0];
    for (var index = 0; index < (root as (RR.Fiber | number)[]).length; ) {
      var fiber: RR.Fiber | null = (root as (RR.Fiber | number)[])[index++] as RR.Fiber,
        tag: RR.WorkTag = fiber.tag,
        selectorIndex: number = (root as (RR.Fiber | number)[])[index++] as number,
        selector: RR.Selector | undefined = selectors[selectorIndex];
      if ((5 !== tag && 26 !== tag && 27 !== tag) || !isHiddenSubtree!(fiber)) {
        for (; null != selector && matchSelector(fiber, selector); )
          selectorIndex++, (selector = selectors[selectorIndex]);
        if (selectorIndex === selectors.length) matchingFibers.push(fiber);
        else
          for (fiber = fiber.child; null !== fiber; )
            (root as (RR.Fiber | number)[]).push(fiber, selectorIndex), (fiber = fiber.sibling);
      }
    }
    return matchingFibers;
  }
  function findAllNodes(hostRoot: RR.Instance | RR.Fiber | RR.Fiber[], selectors: RR.Selector[] | RR.StateNode[]): RR.StateNode[] {
    if (!supportsTestSelectors) throw Error(formatProdErrorMessage(363));
    hostRoot = findFiberRootForHostRoot((hostRoot as RR.Instance));
    hostRoot = findPaths(hostRoot, (selectors as RR.Selector[]));
    selectors = [] as RR.StateNode[];
    hostRoot = Array.from(hostRoot);
    for (var index = 0; index < hostRoot.length; ) {
      var node: RR.Fiber | null = hostRoot[index++]!,
        tag: RR.WorkTag = node.tag;
      if (5 === tag || 26 === tag || 27 === tag)
        isHiddenSubtree!(node) || selectors.push(node.stateNode);
      else
        for (node = node.child; null !== node; )
          hostRoot.push(node), (node = node.sibling);
    }
    return selectors;
  }
  function requestUpdateLane(fiber?: RR.Fiber): RR.Lane; function requestUpdateLane(): RR.Lane {
    return 0 !== (executionContext & 2) && 0 !== workInProgressRootRenderLanes
      ? workInProgressRootRenderLanes & -workInProgressRootRenderLanes
      : null !== ReactSharedInternals.T
        ? requestTransitionLane()
        : resolveUpdatePriority() as RR.Lane;
  }
  function requestDeferredLane(): RR.Lane {
    if (0 === workInProgressDeferredLane)
      if (0 === (workInProgressRootRenderLanes & 536870912) || isHydrating) {
        var lane: RR.Lane | RR.Fiber | null = nextTransitionDeferredLane;
        nextTransitionDeferredLane <<= 1;
        0 === (nextTransitionDeferredLane & 3932160) &&
          (nextTransitionDeferredLane = 262144);
        workInProgressDeferredLane = lane;
      } else workInProgressDeferredLane = 536870912;
    lane = suspenseHandlerStackCursor.current;
    null !== lane && (lane.flags |= 32);
    return workInProgressDeferredLane;
  }
  function scheduleUpdateOnFiber(root: RR.FiberRoot, fiber: RR.Fiber, lane: RR.Lane): void {
    if (
      (root === workInProgressRoot &&
        (2 === workInProgressSuspendedReason ||
          9 === workInProgressSuspendedReason)) ||
      null !== root.cancelPendingCommit
    )
      prepareFreshStack(root, 0),
        markRootSuspended(
          root,
          workInProgressRootRenderLanes,
          workInProgressDeferredLane,
          !1
        );
    markRootUpdated$1(root, lane);
    if (0 === (executionContext & 2) || root !== workInProgressRoot)
      root === workInProgressRoot &&
        (0 === (executionContext & 2) &&
          (workInProgressRootInterleavedUpdatedLanes |= lane),
        4 === workInProgressRootExitStatus &&
          markRootSuspended(
            root,
            workInProgressRootRenderLanes,
            workInProgressDeferredLane,
            !1
          )),
        ensureRootIsScheduled(root);
  }
  function performWorkOnRoot(root$jscomp$0: RR.FiberRoot, lanes: RR.Lanes, forceSync: boolean | RR.Fiber): void {
    if (0 !== (executionContext & 6)) throw Error(formatProdErrorMessage(327));
    var shouldTimeSlice: boolean | RR.FiberRoot =
        (!(forceSync as boolean) &&
          0 === (lanes & 127) &&
          0 === (lanes & root$jscomp$0.expiredLanes)) ||
        checkIfRootIsPrerendering(root$jscomp$0, lanes),
      exitStatus: RR.RootExitStatus | RR.CapturedValue[] | RR.Milliseconds | null = shouldTimeSlice
        ? renderRootConcurrent(root$jscomp$0, lanes)
        : renderRootSync(root$jscomp$0, lanes, !0),
      renderWasConcurrent: boolean | RR.Lanes | RR.CapturedValue[] | RR.RootExitStatus | null = shouldTimeSlice;
    do {
      if (0 === exitStatus) {
        workInProgressRootIsPrerendering &&
          !shouldTimeSlice &&
          markRootSuspended(root$jscomp$0, lanes, 0, !1);
        break;
      } else {
        forceSync = root$jscomp$0.current!.alternate!;
        if (
          renderWasConcurrent &&
          !isRenderConsistentWithExternalStores(forceSync)
        ) {
          exitStatus = renderRootSync(root$jscomp$0, lanes, !1);
          renderWasConcurrent = !1;
          continue;
        }
        if (2 === exitStatus) {
          renderWasConcurrent = lanes;
          if (root$jscomp$0.errorRecoveryDisabledLanes & renderWasConcurrent)
            var JSCompiler_inline_result: RR.Lanes | RR.RootExitStatus = 0;
          else
            (JSCompiler_inline_result =
              root$jscomp$0.pendingLanes & -536870913),
              (JSCompiler_inline_result =
                0 !== JSCompiler_inline_result
                  ? JSCompiler_inline_result
                  : JSCompiler_inline_result & 536870912
                    ? 536870912
                    : 0);
          if (0 !== JSCompiler_inline_result) {
            lanes = JSCompiler_inline_result;
            a: {
              var root: RR.FiberRoot = root$jscomp$0;
              exitStatus = workInProgressRootConcurrentErrors;
              var wasRootDehydrated: boolean =
                supportsHydration && (root.current!.memoizedState as RR.RootState).isDehydrated;
              wasRootDehydrated &&
                (prepareFreshStack(root, JSCompiler_inline_result).flags |=
                  256);
              JSCompiler_inline_result = renderRootSync(
                root,
                JSCompiler_inline_result,
                !1
              );
              if (2 !== JSCompiler_inline_result) {
                if (
                  workInProgressRootDidAttachPingListener &&
                  !wasRootDehydrated
                ) {
                  root.errorRecoveryDisabledLanes |= renderWasConcurrent;
                  workInProgressRootInterleavedUpdatedLanes |=
                    renderWasConcurrent;
                  exitStatus = 4;
                  break a;
                }
                renderWasConcurrent = workInProgressRootRecoverableErrors;
                workInProgressRootRecoverableErrors = exitStatus;
                null !== renderWasConcurrent &&
                  (null === workInProgressRootRecoverableErrors
                    ? (workInProgressRootRecoverableErrors =
                        renderWasConcurrent)
                    : workInProgressRootRecoverableErrors.push.apply(
                        workInProgressRootRecoverableErrors,
                        renderWasConcurrent
                      ));
              }
              exitStatus = JSCompiler_inline_result;
            }
            renderWasConcurrent = !1;
            if (2 !== exitStatus) continue;
          }
        }
        if (1 === exitStatus) {
          prepareFreshStack(root$jscomp$0, 0);
          markRootSuspended(root$jscomp$0, lanes, 0, !0);
          break;
        }
        a: {
          shouldTimeSlice = root$jscomp$0;
          renderWasConcurrent = exitStatus;
          switch (renderWasConcurrent) {
            case 0:
            case 1:
              throw Error(formatProdErrorMessage(345));
            case 4:
              if ((lanes & 4194048) !== lanes) break;
            case 6:
              markRootSuspended(
                shouldTimeSlice,
                lanes,
                workInProgressDeferredLane,
                !workInProgressRootDidSkipSuspendedSiblings
              );
              break a;
            case 2:
              workInProgressRootRecoverableErrors = null;
              break;
            case 3:
            case 5:
              break;
            default:
              throw Error(formatProdErrorMessage(329));
          }
          if (
            (lanes & 62914560) === lanes &&
            ((exitStatus = globalMostRecentFallbackTime + 300 - now()),
            10 < exitStatus)
          ) {
            markRootSuspended(
              shouldTimeSlice,
              lanes,
              workInProgressDeferredLane,
              !workInProgressRootDidSkipSuspendedSiblings
            );
            if (0 !== getNextLanes(shouldTimeSlice, 0, !0)) break a;
            pendingEffectsLanes = lanes;
            shouldTimeSlice.timeoutHandle = scheduleTimeout(
              commitRootWhenReady.bind(
                null,
                shouldTimeSlice,
                forceSync,
                workInProgressRootRecoverableErrors,
                workInProgressTransitions,
                workInProgressRootDidIncludeRecursiveRenderUpdate,
                lanes,
                workInProgressDeferredLane,
                workInProgressRootInterleavedUpdatedLanes,
                workInProgressSuspendedRetryLanes,
                workInProgressRootDidSkipSuspendedSiblings,
                renderWasConcurrent,
                "Throttled",
                -0,
                0
              ),
              exitStatus
            );
            break a;
          }
          commitRootWhenReady(
            shouldTimeSlice,
            forceSync,
            workInProgressRootRecoverableErrors,
            workInProgressTransitions,
            workInProgressRootDidIncludeRecursiveRenderUpdate,
            lanes,
            workInProgressDeferredLane,
            workInProgressRootInterleavedUpdatedLanes,
            workInProgressSuspendedRetryLanes,
            workInProgressRootDidSkipSuspendedSiblings,
            renderWasConcurrent,
            null,
            -0,
            0
          );
        }
      }
      break;
    } while (1);
    ensureRootIsScheduled(root$jscomp$0);
  }
  function commitRootWhenReady(
    root: RR.FiberRoot,
    finishedWork: RR.Fiber,
    recoverableErrors: RR.CapturedValue[] | null,
    transitions: RR.Transition[] | null,
    didIncludeRenderPhaseUpdate: boolean,
    lanes: RR.Lanes,
    spawnedLane: RR.Lane,
    updatedLanes: RR.Lanes,
    suspendedRetryLanes: RR.Lanes,
    didSkipSuspendedSiblings: boolean,
    exitStatus: RR.RootExitStatus,
    suspendedCommitReason: RR.SuspendedCommitReason | RR.Flags | RR.SuspendedState,
    completedRenderStartTime: RR.Milliseconds,
    completedRenderEndTime: RR.Milliseconds
  ): void {
    root.timeoutHandle = noTimeout;
    suspendedCommitReason = finishedWork.subtreeFlags;
    if (
      suspendedCommitReason & 8192 ||
      16785408 === (suspendedCommitReason & 16785408)
    ) {
      suspendedCommitReason = startSuspendingCommit();
      accumulateSuspenseyCommitOnFiber(
        finishedWork,
        lanes,
        suspendedCommitReason
      );
      var timeoutOffset: RR.Milliseconds | RR.ScheduleCommit | null =
        (lanes & 62914560) === lanes
          ? globalMostRecentFallbackTime - now()
          : (lanes & 4194048) === lanes
            ? globalMostRecentTransitionTime - now()
            : 0;
      timeoutOffset = waitForCommitToBeReady(
        suspendedCommitReason,
        timeoutOffset
      );
      if (null !== timeoutOffset) {
        pendingEffectsLanes = lanes;
        root.cancelPendingCommit = timeoutOffset(
          commitRoot.bind(
            null,
            root,
            finishedWork,
            lanes,
            recoverableErrors,
            transitions,
            didIncludeRenderPhaseUpdate,
            spawnedLane,
            updatedLanes,
            suspendedRetryLanes,
            exitStatus,
            suspendedCommitReason,
            null,
            completedRenderStartTime,
            completedRenderEndTime
          )
        );
        markRootSuspended(root, lanes, spawnedLane, !didSkipSuspendedSiblings);
        return;
      }
    }
    commitRoot(
      root,
      finishedWork,
      lanes,
      recoverableErrors,
      transitions,
      didIncludeRenderPhaseUpdate,
      spawnedLane,
      updatedLanes,
      suspendedRetryLanes
    );
  }
  function isRenderConsistentWithExternalStores(finishedWork: RR.Fiber): boolean {
    for (var node: RR.Fiber = finishedWork; ; ) {
      var tag: number | RR.FunctionComponentUpdateQueue | RR.StoreConsistencyCheck[] | RR.Fiber | null = node.tag;
      if (
        (0 === tag || 11 === tag || 15 === tag) &&
        node.flags & 16384 &&
        ((tag = node.updateQueue as RR.FunctionComponentUpdateQueue | null),
        null !== tag && ((tag = tag.stores), null !== tag))
      )
        for (var i = 0; i < (tag as RR.StoreConsistencyCheck[]).length; i++) {
          var check: RR.StoreConsistencyCheck | RR.StoreConsistencyCheck["value"] = (tag as RR.StoreConsistencyCheck[])[i],
            getSnapshot: RR.GetSnapshot = check.getSnapshot;
          check = check.value;
          try {
            if (!objectIs(getSnapshot(), check)) return !1;
          } catch (error) {
            return !1;
          }
        }
      tag = node.child;
      if (node.subtreeFlags & 16384 && null !== tag)
        (tag.return = node), (node = tag);
      else {
        if (node === finishedWork) break;
        for (; null === node.sibling; ) {
          if (null === node.return || node.return === finishedWork) return !0;
          node = node.return;
        }
        node.sibling.return = node.return;
        node = node.sibling;
      }
    }
    return !0;
  }
  function markRootSuspended(
    root: RR.FiberRoot,
    suspendedLanes: RR.Lanes,
    spawnedLane: RR.Lane,
    didAttemptEntireTree: boolean | RR.FiberRoot["expirationTimes"]
  ): void {
    suspendedLanes &= ~workInProgressRootPingedLanes;
    suspendedLanes &= ~workInProgressRootInterleavedUpdatedLanes;
    root.suspendedLanes |= suspendedLanes;
    root.pingedLanes &= ~suspendedLanes;
    (didAttemptEntireTree as boolean) && (root.warmLanes |= suspendedLanes);
    didAttemptEntireTree = root.expirationTimes;
    for (var lanes: RR.Lanes = suspendedLanes; 0 < lanes; ) {
      var index$4: number = 31 - clz32(lanes),
        lane: RR.Lane = 1 << index$4;
      didAttemptEntireTree[index$4] = -1;
      lanes &= ~lane;
    }
    0 !== spawnedLane &&
      markSpawnedDeferredLane(root, spawnedLane, suspendedLanes);
  }
  function flushSyncWork(): boolean {
    return 0 === (executionContext & 6)
      ? (flushSyncWorkAcrossRoots_impl(0, !1), !1)
      : !0;
  }
  function resetWorkInProgressStack(): void {
    if (null !== workInProgress) {
      if (0 === workInProgressSuspendedReason)
        var interruptedWork: RR.Fiber | null = workInProgress.return;
      else
        (interruptedWork = workInProgress),
          (lastContextDependency = currentlyRenderingFiber$1 = null),
          resetHooksOnUnwind(interruptedWork),
          (thenableState$1 = null),
          (thenableIndexCounter$1 = 0),
          (interruptedWork = workInProgress);
      for (; null !== interruptedWork; )
        unwindInterruptedWork(interruptedWork.alternate, interruptedWork),
          (interruptedWork = interruptedWork.return);
      workInProgress = null;
    }
  }
  function prepareFreshStack(root: RR.FiberRoot | RR.FiberRoot["entanglements"], lanes: RR.Lanes): RR.Fiber {
    var timeoutHandle: RR.TimeoutHandle | RR.NoTimeout | RR.FiberRoot["cancelPendingCommit"] | RR.Fiber = (root as RR.FiberRoot).timeoutHandle;
    timeoutHandle !== noTimeout &&
      (((root as RR.FiberRoot).timeoutHandle = noTimeout), cancelTimeout((timeoutHandle as RR.TimeoutHandle | RR.NoTimeout)));
    timeoutHandle = (root as RR.FiberRoot).cancelPendingCommit;
    null !== timeoutHandle &&
      (((root as RR.FiberRoot).cancelPendingCommit = null), (timeoutHandle as RR.FiberRoot["cancelPendingCommit"])!());
    pendingEffectsLanes = 0;
    resetWorkInProgressStack();
    workInProgressRoot = (root as RR.FiberRoot);
    workInProgress = timeoutHandle = createWorkInProgress((root as RR.FiberRoot).current!, null);
    workInProgressRootRenderLanes = lanes;
    workInProgressSuspendedReason = 0;
    workInProgressThrownValue = null;
    workInProgressRootDidSkipSuspendedSiblings = !1;
    workInProgressRootIsPrerendering = checkIfRootIsPrerendering((root as RR.FiberRoot), lanes);
    workInProgressRootDidAttachPingListener = !1;
    workInProgressSuspendedRetryLanes =
      workInProgressDeferredLane =
      workInProgressRootPingedLanes =
      workInProgressRootInterleavedUpdatedLanes =
      workInProgressRootSkippedLanes =
      workInProgressRootExitStatus =
        0;
    workInProgressRootRecoverableErrors = workInProgressRootConcurrentErrors =
      null;
    workInProgressRootDidIncludeRecursiveRenderUpdate = !1;
    0 !== (lanes & 8) && (lanes |= lanes & 32);
    var allEntangledLanes: RR.Lanes = (root as RR.FiberRoot).entangledLanes;
    if (0 !== allEntangledLanes)
      for (
        root = (root as RR.FiberRoot).entanglements, allEntangledLanes &= lanes;
        0 < allEntangledLanes;

      ) {
        var index$2: number = 31 - clz32(allEntangledLanes),
          lane: RR.Lane = 1 << index$2;
        lanes |= (root as RR.FiberRoot["entanglements"])[index$2]!;
        allEntangledLanes &= ~lane;
      }
    entangledRenderLanes = lanes;
    finishQueueingConcurrentUpdates();
    return timeoutHandle;
  }
  function handleThrow(root: RR.FiberRoot, thrownValue: RR.Thrown): void {
    currentlyRenderingFiber = null;
    ReactSharedInternals.H = ContextOnlyDispatcher;
    thrownValue === SuspenseException || thrownValue === SuspenseActionException
      ? ((thrownValue = getSuspendedThenable()),
        (workInProgressSuspendedReason = 3))
      : thrownValue === SuspenseyCommitException
        ? ((thrownValue = getSuspendedThenable()),
          (workInProgressSuspendedReason = 4))
        : (workInProgressSuspendedReason =
            thrownValue === SelectiveHydrationException
              ? 8
              : null !== thrownValue &&
                  "object" === typeof thrownValue &&
                  "function" === typeof thrownValue.then
                ? 6
                : 1);
    workInProgressThrownValue = thrownValue;
    null === workInProgress &&
      ((workInProgressRootExitStatus = 1),
      logUncaughtError(
        root,
        createCapturedValueAtFiber(thrownValue, root.current!)
      ));
  }
  function shouldRemainOnPreviousScreen(): boolean {
    var handler: RR.Fiber | null = suspenseHandlerStackCursor.current;
    return null === handler
      ? !0
      : (workInProgressRootRenderLanes & 4194048) ===
          workInProgressRootRenderLanes
        ? null === shellBoundary
          ? !0
          : !1
        : (workInProgressRootRenderLanes & 62914560) ===
              workInProgressRootRenderLanes ||
            0 !== (workInProgressRootRenderLanes & 536870912)
          ? handler === shellBoundary
          : !1;
  }
  function pushDispatcher(): RR.Dispatcher {
    var prevDispatcher: RR.Dispatcher | null = ReactSharedInternals.H;
    ReactSharedInternals.H = ContextOnlyDispatcher;
    return null === prevDispatcher ? ContextOnlyDispatcher : prevDispatcher;
  }
  function pushAsyncDispatcher(): RR.AsyncDispatcher | null {
    var prevAsyncDispatcher: RR.AsyncDispatcher | null = ReactSharedInternals.A;
    ReactSharedInternals.A = DefaultAsyncDispatcher;
    return prevAsyncDispatcher;
  }
  function renderDidSuspendDelayIfPossible(): void {
    workInProgressRootExitStatus = 4;
    workInProgressRootDidSkipSuspendedSiblings ||
      ((workInProgressRootRenderLanes & 4194048) !==
        workInProgressRootRenderLanes &&
        null !== suspenseHandlerStackCursor.current) ||
      (workInProgressRootIsPrerendering = !0);
    (0 === (workInProgressRootSkippedLanes & 134217727) &&
      0 === (workInProgressRootInterleavedUpdatedLanes & 134217727)) ||
      null === workInProgressRoot ||
      markRootSuspended(
        workInProgressRoot,
        workInProgressRootRenderLanes,
        workInProgressDeferredLane,
        !1
      );
  }
  function renderRootSync(root: RR.FiberRoot, lanes: RR.Lanes | boolean, shouldYieldForPrerendering: boolean): RR.RootExitStatus {
    var prevExecutionContext: RR.ExecutionContext = executionContext;
    executionContext |= 2;
    var prevDispatcher: RR.Dispatcher = pushDispatcher(),
      prevAsyncDispatcher: RR.AsyncDispatcher | null = pushAsyncDispatcher();
    if (workInProgressRoot !== root || workInProgressRootRenderLanes !== (lanes as RR.Lanes))
      (workInProgressTransitions = null), prepareFreshStack(root, (lanes as RR.Lanes));
    lanes = !1;
    var exitStatus: RR.RootExitStatus = workInProgressRootExitStatus;
    a: do
      try {
        if (0 !== workInProgressSuspendedReason && null !== workInProgress) {
          var unitOfWork: RR.Fiber = workInProgress,
            thrownValue: RR.Thrown = workInProgressThrownValue;
          switch (workInProgressSuspendedReason) {
            case 8:
              resetWorkInProgressStack();
              exitStatus = 6;
              break a;
            case 3:
            case 2:
            case 9:
            case 6:
              null === suspenseHandlerStackCursor.current && (lanes = !0);
              var reason: RR.SuspendedReason = workInProgressSuspendedReason;
              workInProgressSuspendedReason = 0;
              workInProgressThrownValue = null;
              throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
              if (
                shouldYieldForPrerendering &&
                workInProgressRootIsPrerendering
              ) {
                exitStatus = 0;
                break a;
              }
              break;
            default:
              (reason = workInProgressSuspendedReason),
                (workInProgressSuspendedReason = 0),
                (workInProgressThrownValue = null),
                throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
          }
        }
        workLoopSync();
        exitStatus = workInProgressRootExitStatus;
        break;
      } catch (thrownValue$152) {
        handleThrow(root, thrownValue$152);
      }
    while (1);
    lanes && root.shellSuspendCounter++;
    lastContextDependency = currentlyRenderingFiber$1 = null;
    executionContext = prevExecutionContext;
    ReactSharedInternals.H = prevDispatcher;
    ReactSharedInternals.A = prevAsyncDispatcher;
    null === workInProgress &&
      ((workInProgressRoot = null),
      (workInProgressRootRenderLanes = 0),
      finishQueueingConcurrentUpdates());
    return exitStatus;
  }
  function workLoopSync(): void {
    for (; null !== workInProgress; ) performUnitOfWork(workInProgress);
  }
  function renderRootConcurrent(root: RR.FiberRoot, lanes: RR.Lanes | RR.Fiber | (() => void)): RR.RootExitStatus {
    var prevExecutionContext: RR.ExecutionContext = executionContext;
    executionContext |= 2;
    var prevDispatcher: RR.Dispatcher = pushDispatcher(),
      prevAsyncDispatcher: RR.AsyncDispatcher | null = pushAsyncDispatcher();
    workInProgressRoot !== root || workInProgressRootRenderLanes !== (lanes as RR.Lanes)
      ? ((workInProgressTransitions = null),
        (workInProgressRootRenderTargetTime = now() + 500),
        prepareFreshStack(root, (lanes as RR.Lanes)))
      : (workInProgressRootIsPrerendering = checkIfRootIsPrerendering(
          root,
          (lanes as RR.Lanes)
        ));
    a: do
      try {
        if (0 !== workInProgressSuspendedReason && null !== workInProgress) {
          lanes = workInProgress;
          var thrownValue: RR.Thrown = workInProgressThrownValue;
          b: switch (workInProgressSuspendedReason) {
            case 1:
              workInProgressSuspendedReason = 0;
              workInProgressThrownValue = null;
              throwAndUnwindWorkLoop(root, lanes, thrownValue, 1);
              break;
            case 2:
            case 9:
              if (isThenableResolved(thrownValue)) {
                workInProgressSuspendedReason = 0;
                workInProgressThrownValue = null;
                replaySuspendedUnitOfWork(lanes);
                break;
              }
              lanes = function () {
                (2 !== workInProgressSuspendedReason &&
                  9 !== workInProgressSuspendedReason) ||
                  workInProgressRoot !== root ||
                  (workInProgressSuspendedReason = 7);
                ensureRootIsScheduled(root);
              };
              thrownValue.then(lanes, lanes);
              break a;
            case 3:
              workInProgressSuspendedReason = 7;
              break a;
            case 4:
              workInProgressSuspendedReason = 5;
              break a;
            case 7:
              isThenableResolved(thrownValue)
                ? ((workInProgressSuspendedReason = 0),
                  (workInProgressThrownValue = null),
                  replaySuspendedUnitOfWork(lanes))
                : ((workInProgressSuspendedReason = 0),
                  (workInProgressThrownValue = null),
                  throwAndUnwindWorkLoop(root, lanes, thrownValue, 7));
              break;
            case 5:
              var resource: RR.ResourceArg = null;
              switch (workInProgress.tag) {
                case 26:
                  resource = workInProgress.memoizedState;
                case 5:
                case 27:
                  var hostFiber: RR.Fiber = workInProgress,
                    type: RR.HostType = hostFiber.type,
                    props: RR.Props = hostFiber.pendingProps;
                  if (
                    resource
                      ? preloadResource!(resource)
                      : preloadInstance(hostFiber.stateNode, type, props)
                  ) {
                    workInProgressSuspendedReason = 0;
                    workInProgressThrownValue = null;
                    var sibling: RR.Fiber | null = hostFiber.sibling;
                    if (null !== sibling) workInProgress = sibling;
                    else {
                      var returnFiber: RR.Fiber | null = hostFiber.return;
                      null !== returnFiber
                        ? ((workInProgress = returnFiber),
                          completeUnitOfWork(returnFiber))
                        : (workInProgress = null);
                    }
                    break b;
                  }
              }
              workInProgressSuspendedReason = 0;
              workInProgressThrownValue = null;
              throwAndUnwindWorkLoop(root, lanes, thrownValue, 5);
              break;
            case 6:
              workInProgressSuspendedReason = 0;
              workInProgressThrownValue = null;
              throwAndUnwindWorkLoop(root, lanes, thrownValue, 6);
              break;
            case 8:
              resetWorkInProgressStack();
              workInProgressRootExitStatus = 6;
              break a;
            default:
              throw Error(formatProdErrorMessage(462));
          }
        }
        workLoopConcurrentByScheduler();
        break;
      } catch (thrownValue$154) {
        handleThrow(root, thrownValue$154);
      }
    while (1);
    lastContextDependency = currentlyRenderingFiber$1 = null;
    ReactSharedInternals.H = prevDispatcher;
    ReactSharedInternals.A = prevAsyncDispatcher;
    executionContext = prevExecutionContext;
    if (null !== workInProgress) return 0;
    workInProgressRoot = null;
    workInProgressRootRenderLanes = 0;
    finishQueueingConcurrentUpdates();
    return workInProgressRootExitStatus;
  }
  function workLoopConcurrentByScheduler(): void {
    for (; null !== workInProgress && !shouldYield(); )
      performUnitOfWork(workInProgress);
  }
  function performUnitOfWork(unitOfWork: RR.Fiber): void {
    var next: RR.Fiber | null = beginWork(
      unitOfWork.alternate,
      unitOfWork,
      entangledRenderLanes
    );
    unitOfWork.memoizedProps = unitOfWork.pendingProps;
    null === next ? completeUnitOfWork(unitOfWork) : (workInProgress = next);
  }
  function replaySuspendedUnitOfWork(unitOfWork: RR.Fiber): void {
    var next: RR.Fiber | null = unitOfWork;
    var current: RR.Fiber | null = next.alternate;
    switch (next.tag) {
      case 15:
      case 0:
        next = replayFunctionComponent(
          current,
          next,
          next.pendingProps,
          next.type as RR.FunctionComponent,
          void 0,
          workInProgressRootRenderLanes
        );
        break;
      case 11:
        next = replayFunctionComponent(
          current,
          next,
          next.pendingProps,
          (next.type as RR.ForwardRefType).render,
          next.ref,
          workInProgressRootRenderLanes
        );
        break;
      case 5:
        resetHooksOnUnwind(next);
      default:
        unwindInterruptedWork(current, next),
          (next = workInProgress =
            resetWorkInProgress(next, entangledRenderLanes)),
          (next = beginWork(current, next, entangledRenderLanes));
    }
    unitOfWork.memoizedProps = unitOfWork.pendingProps;
    null === next ? completeUnitOfWork(unitOfWork) : (workInProgress = next);
  }
  function throwAndUnwindWorkLoop(
    root: RR.FiberRoot | boolean,
    unitOfWork: RR.Fiber,
    thrownValue: RR.Thrown,
    suspendedReason: RR.SuspendedReason | RR.Fiber | null
  ): void {
    lastContextDependency = currentlyRenderingFiber$1 = null;
    resetHooksOnUnwind(unitOfWork);
    thenableState$1 = null;
    thenableIndexCounter$1 = 0;
    var returnFiber: RR.Fiber | null = unitOfWork.return;
    try {
      if (
        throwException(
          (root as RR.FiberRoot),
          returnFiber,
          unitOfWork,
          thrownValue,
          workInProgressRootRenderLanes
        )
      ) {
        workInProgressRootExitStatus = 1;
        logUncaughtError(
          (root as RR.FiberRoot),
          createCapturedValueAtFiber(thrownValue, (root as RR.FiberRoot).current!)
        );
        workInProgress = null;
        return;
      }
    } catch (error) {
      if (null !== returnFiber) throw ((workInProgress = returnFiber), error);
      workInProgressRootExitStatus = 1;
      logUncaughtError(
        (root as RR.FiberRoot),
        createCapturedValueAtFiber(thrownValue, (root as RR.FiberRoot).current!)
      );
      workInProgress = null;
      return;
    }
    if (unitOfWork.flags & 32768) {
      if (isHydrating || 1 === (suspendedReason as RR.SuspendedReason)) root = !0;
      else if (
        workInProgressRootIsPrerendering ||
        0 !== (workInProgressRootRenderLanes & 536870912)
      )
        root = !1;
      else if (
        ((workInProgressRootDidSkipSuspendedSiblings = root = !0),
        2 === (suspendedReason as RR.SuspendedReason) ||
          9 === (suspendedReason as RR.SuspendedReason) ||
          3 === (suspendedReason as RR.SuspendedReason) ||
          6 === (suspendedReason as RR.SuspendedReason))
      )
        (suspendedReason = suspenseHandlerStackCursor.current),
          null !== suspendedReason &&
            13 === suspendedReason.tag &&
            (suspendedReason.flags |= 16384);
      unwindUnitOfWork(unitOfWork, root);
    } else completeUnitOfWork(unitOfWork);
  }
  function completeUnitOfWork(unitOfWork: RR.Fiber | null): void {
    var completedWork: RR.Fiber | null = unitOfWork!;
    do {
      if (0 !== (completedWork.flags & 32768)) {
        unwindUnitOfWork(
          completedWork,
          workInProgressRootDidSkipSuspendedSiblings
        );
        return;
      }
      unitOfWork = completedWork.return;
      var next: RR.Fiber | null = completeWork(
        completedWork.alternate,
        completedWork,
        entangledRenderLanes
      );
      if (null !== next) {
        workInProgress = next;
        return;
      }
      completedWork = completedWork.sibling;
      if (null !== completedWork) {
        workInProgress = completedWork;
        return;
      }
      workInProgress = completedWork = unitOfWork;
    } while (null !== completedWork);
    0 === workInProgressRootExitStatus && (workInProgressRootExitStatus = 5);
  }
  function unwindUnitOfWork(unitOfWork: RR.Fiber | null, skipSiblings: boolean): void {
    do {
      var next: RR.Fiber | null = unwindWork(unitOfWork!.alternate, (unitOfWork as RR.Fiber));
      if (null !== next) {
        next.flags &= 32767;
        workInProgress = next;
        return;
      }
      next = unitOfWork!.return;
      null !== next &&
        ((next.flags |= 32768),
        (next.subtreeFlags = 0),
        (next.deletions = null));
      if (
        !skipSiblings &&
        ((unitOfWork = unitOfWork!.sibling), null !== unitOfWork)
      ) {
        workInProgress = unitOfWork;
        return;
      }
      workInProgress = unitOfWork = next;
    } while (null !== unitOfWork);
    workInProgressRootExitStatus = 6;
    workInProgress = null;
  }
  function commitRoot(root: RR.FiberRoot, finishedWork: RR.Fiber | null, lanes: RR.Lanes, recoverableErrors: RR.CapturedValue[] | null, transitions: RR.Transition[] | null, didIncludeRenderPhaseUpdate: boolean, spawnedLane: RR.Lane, updatedLanes: RR.Lanes, suspendedRetryLanes: RR.Lanes, exitStatus?: RR.RootExitStatus, suspendedState?: RR.SuspendedState, suspendedCommitReason?: null, completedRenderStartTime?: RR.Milliseconds, completedRenderEndTime?: RR.Milliseconds): void; function commitRoot(
    root: RR.FiberRoot,
    finishedWork: RR.Fiber | null,
    lanes: RR.Lanes,
    recoverableErrors: RR.CapturedValue[] | boolean | RR.Transition | null,
    transitions: RR.Transition[] | RR.EventPriority | null,
    didIncludeRenderPhaseUpdate: boolean | RR.Lanes,
    spawnedLane: RR.Lane | RR.ExecutionContext,
    updatedLanes: RR.Lanes,
    suspendedRetryLanes: RR.Lanes
  ): void {
    root.cancelPendingCommit = null;
    do flushPendingEffects();
    while (0 !== pendingEffectsStatus);
    if (0 !== (executionContext & 6)) throw Error(formatProdErrorMessage(327));
    if (null !== finishedWork) {
      if (finishedWork === root.current)
        throw Error(formatProdErrorMessage(177));
      didIncludeRenderPhaseUpdate =
        finishedWork.lanes | finishedWork.childLanes;
      didIncludeRenderPhaseUpdate |= concurrentlyUpdatedLanes;
      markRootFinished(
        root,
        lanes,
        didIncludeRenderPhaseUpdate,
        spawnedLane,
        updatedLanes,
        suspendedRetryLanes
      );
      root === workInProgressRoot &&
        ((workInProgress = workInProgressRoot = null),
        (workInProgressRootRenderLanes = 0));
      pendingFinishedWork = finishedWork;
      pendingEffectsRoot = root;
      pendingEffectsLanes = lanes;
      pendingEffectsRemainingLanes = didIncludeRenderPhaseUpdate;
      pendingPassiveTransitions = (transitions as RR.Transition[] | null);
      pendingRecoverableErrors = (recoverableErrors as RR.CapturedValue[] | null);
      0 !== (finishedWork.subtreeFlags & 10256) ||
      0 !== (finishedWork.flags & 10256)
        ? ((root.callbackNode = null),
          (root.callbackPriority = 0),
          scheduleCallback(NormalPriority$1, function () {
            flushPassiveEffects();
            return null;
          }))
        : ((root.callbackNode = null), (root.callbackPriority = 0));
      recoverableErrors = 0 !== (finishedWork.flags & 13878);
      if (0 !== (finishedWork.subtreeFlags & 13878) || recoverableErrors) {
        recoverableErrors = ReactSharedInternals.T;
        ReactSharedInternals.T = null;
        transitions = getCurrentUpdatePriority();
        setCurrentUpdatePriority(2);
        spawnedLane = executionContext;
        executionContext |= 4;
        try {
          commitBeforeMutationEffects(root, finishedWork, lanes);
        } finally {
          (executionContext = spawnedLane),
            setCurrentUpdatePriority(transitions),
            (ReactSharedInternals.T = recoverableErrors);
        }
      }
      pendingEffectsStatus = 1;
      flushMutationEffects();
      flushLayoutEffects();
      flushSpawnedWork();
    }
  }
  function flushMutationEffects() {
    if (1 === pendingEffectsStatus) {
      pendingEffectsStatus = 0;
      var root: RR.FiberRoot = pendingEffectsRoot!,
        finishedWork: RR.Fiber = pendingFinishedWork!,
        rootMutationHasEffect: boolean | RR.Transition | null = 0 !== (finishedWork.flags & 13878);
      if (0 !== (finishedWork.subtreeFlags & 13878) || rootMutationHasEffect) {
        rootMutationHasEffect = ReactSharedInternals.T;
        ReactSharedInternals.T = null;
        var previousPriority: RR.EventPriority = getCurrentUpdatePriority();
        setCurrentUpdatePriority(2);
        var prevExecutionContext: RR.ExecutionContext = executionContext;
        executionContext |= 4;
        try {
          commitMutationEffectsOnFiber(finishedWork, root),
            resetAfterCommit(root.containerInfo);
        } finally {
          (executionContext = prevExecutionContext),
            setCurrentUpdatePriority(previousPriority),
            (ReactSharedInternals.T = rootMutationHasEffect);
        }
      }
      root.current = finishedWork;
      pendingEffectsStatus = 2;
    }
  }
  function flushLayoutEffects() {
    if (2 === pendingEffectsStatus) {
      pendingEffectsStatus = 0;
      var root: RR.FiberRoot = pendingEffectsRoot!,
        finishedWork: RR.Fiber = pendingFinishedWork!,
        rootHasLayoutEffect: boolean | RR.Transition | null = 0 !== (finishedWork.flags & 8772);
      if (0 !== (finishedWork.subtreeFlags & 8772) || rootHasLayoutEffect) {
        rootHasLayoutEffect = ReactSharedInternals.T;
        ReactSharedInternals.T = null;
        var previousPriority: RR.EventPriority = getCurrentUpdatePriority();
        setCurrentUpdatePriority(2);
        var prevExecutionContext: RR.ExecutionContext = executionContext;
        executionContext |= 4;
        try {
          commitLayoutEffectOnFiber(root, finishedWork.alternate, finishedWork);
        } finally {
          (executionContext = prevExecutionContext),
            setCurrentUpdatePriority(previousPriority),
            (ReactSharedInternals.T = rootHasLayoutEffect);
        }
      }
      pendingEffectsStatus = 3;
    }
  }
  function flushSpawnedWork() {
    if (4 === pendingEffectsStatus || 3 === pendingEffectsStatus) {
      pendingEffectsStatus = 0;
      requestPaint();
      var root: RR.FiberRoot = pendingEffectsRoot!,
        finishedWork: RR.Fiber | RR.FiberRoot | RR.Transition | null = pendingFinishedWork!,
        lanes: RR.Lanes = pendingEffectsLanes,
        recoverableErrors: RR.CapturedValue[] | null = pendingRecoverableErrors;
      0 !== (finishedWork.subtreeFlags & 10256) ||
      0 !== (finishedWork.flags & 10256)
        ? (pendingEffectsStatus = 5)
        : ((pendingEffectsStatus = 0),
          (pendingFinishedWork = pendingEffectsRoot = null),
          releaseRootPooledCache(root, root.pendingLanes));
      var remainingLanes: RR.Lanes | RR.EventPriority = root.pendingLanes;
      0 === remainingLanes && (legacyErrorBoundariesThatAlreadyFailed = null);
      lanesToEventPriority(lanes);
      finishedWork = finishedWork.stateNode as RR.FiberRoot;
      if (injectedHook && "function" === typeof injectedHook.onCommitFiberRoot)
        try {
          injectedHook.onCommitFiberRoot(
            rendererID,
            finishedWork,
            void 0,
            128 === (finishedWork.current!.flags & 128)
          );
        } catch (err) {}
      if (null !== recoverableErrors) {
        finishedWork = ReactSharedInternals.T;
        remainingLanes = getCurrentUpdatePriority();
        setCurrentUpdatePriority(2);
        ReactSharedInternals.T = null;
        try {
          for (
            var onRecoverableError: RR.OnRecoverableError = root.onRecoverableError, i = 0;
            i < recoverableErrors.length;
            i++
          ) {
            var recoverableError: RR.CapturedValue = recoverableErrors[i]!;
            onRecoverableError(recoverableError.value, {
              componentStack: recoverableError.stack
            });
          }
        } finally {
          (ReactSharedInternals.T = finishedWork),
            setCurrentUpdatePriority(remainingLanes);
        }
      }
      0 !== (pendingEffectsLanes & 3) && flushPendingEffects();
      ensureRootIsScheduled(root);
      remainingLanes = root.pendingLanes;
      0 !== (lanes & 261930) && 0 !== (remainingLanes & 42)
        ? root === rootWithNestedUpdates
          ? nestedUpdateCount++
          : ((nestedUpdateCount = 0), (rootWithNestedUpdates = root))
        : (nestedUpdateCount = 0);
      supportsHydration && flushHydrationEvents!();
      flushSyncWorkAcrossRoots_impl(0, !1);
    }
  }
  function releaseRootPooledCache(root: RR.FiberRoot, remainingLanes: number | RR.Cache | null): void {
    0 === (root.pooledCacheLanes &= (remainingLanes as RR.Lanes)) &&
      ((remainingLanes = root.pooledCache),
      null != remainingLanes &&
        ((root.pooledCache = null), releaseCache(remainingLanes)));
  }
  function flushPendingEffects(): boolean {
    flushMutationEffects();
    flushLayoutEffects();
    flushSpawnedWork();
    return flushPassiveEffects();
  }
  function flushPassiveEffects(): boolean {
    if (5 !== pendingEffectsStatus) return !1;
    var root: RR.FiberRoot = pendingEffectsRoot!,
      remainingLanes: RR.Lanes = pendingEffectsRemainingLanes;
    pendingEffectsRemainingLanes = 0;
    var renderPriority: RR.EventPriority | RR.Transition | null = lanesToEventPriority(pendingEffectsLanes),
      priority: RR.EventPriority | RR.Transition[] | null = 32 > renderPriority ? 32 : renderPriority;
    renderPriority = ReactSharedInternals.T;
    var previousPriority: RR.EventPriority = getCurrentUpdatePriority();
    try {
      setCurrentUpdatePriority(priority);
      ReactSharedInternals.T = null;
      priority = pendingPassiveTransitions;
      pendingPassiveTransitions = null;
      var root$jscomp$0: RR.FiberRoot = pendingEffectsRoot!,
        lanes: RR.Lanes = pendingEffectsLanes;
      pendingEffectsStatus = 0;
      pendingFinishedWork = pendingEffectsRoot = null;
      pendingEffectsLanes = 0;
      if (0 !== (executionContext & 6))
        throw Error(formatProdErrorMessage(331));
      var prevExecutionContext: RR.ExecutionContext = executionContext;
      executionContext |= 4;
      commitPassiveUnmountOnFiber(root$jscomp$0.current!);
      commitPassiveMountOnFiber(
        root$jscomp$0,
        root$jscomp$0.current!,
        lanes,
        priority
      );
      executionContext = prevExecutionContext;
      flushSyncWorkAcrossRoots_impl(0, !1);
      if (
        injectedHook &&
        "function" === typeof injectedHook.onPostCommitFiberRoot
      )
        try {
          injectedHook.onPostCommitFiberRoot(rendererID, root$jscomp$0);
        } catch (err) {}
      return !0;
    } finally {
      setCurrentUpdatePriority(previousPriority),
        (ReactSharedInternals.T = renderPriority),
        releaseRootPooledCache(root, remainingLanes);
    }
  }
  function captureCommitPhaseErrorOnRoot(rootFiber: RR.Fiber | RR.FiberRoot | null, sourceFiber: RR.Fiber | RR.CapturedValue | RR.Update, error: RR.Thrown): void {
    sourceFiber = createCapturedValueAtFiber(error, (sourceFiber as RR.Fiber));
    sourceFiber = createRootErrorUpdate((rootFiber as RR.Fiber).stateNode as RR.FiberRoot, sourceFiber, 2);
    rootFiber = enqueueUpdate((rootFiber as RR.Fiber), sourceFiber, 2);
    null !== rootFiber &&
      (markRootUpdated$1(rootFiber, 2), ensureRootIsScheduled(rootFiber));
  }
  function captureCommitPhaseError(sourceFiber: RR.Fiber | RR.CapturedValue, nearestMountedAncestor: RR.Fiber | null, error: RR.Thrown | RR.Update): void {
    if (3 === (sourceFiber as RR.Fiber).tag)
      captureCommitPhaseErrorOnRoot((sourceFiber as RR.Fiber), (sourceFiber as RR.Fiber), error);
    else
      for (; null !== nearestMountedAncestor; ) {
        if (3 === nearestMountedAncestor.tag) {
          captureCommitPhaseErrorOnRoot(
            nearestMountedAncestor,
            (sourceFiber as RR.Fiber),
            error
          );
          break;
        } else if (1 === nearestMountedAncestor.tag) {
          var instance: RR.ClassInstance | RR.FiberRoot | null = nearestMountedAncestor.stateNode as RR.ClassInstance;
          if (
            "function" ===
              typeof (nearestMountedAncestor.type as RR.ClassComponent).getDerivedStateFromError ||
            ("function" === typeof instance.componentDidCatch &&
              (null === legacyErrorBoundariesThatAlreadyFailed ||
                !legacyErrorBoundariesThatAlreadyFailed.has(instance)))
          ) {
            sourceFiber = createCapturedValueAtFiber(error, (sourceFiber as RR.Fiber));
            error = createClassErrorUpdate(2);
            instance = enqueueUpdate(nearestMountedAncestor, (error as RR.Update), 2);
            null !== instance &&
              (initializeClassErrorUpdate(
                (error as RR.Update),
                instance,
                nearestMountedAncestor,
                sourceFiber
              ),
              markRootUpdated$1(instance, 2),
              ensureRootIsScheduled(instance));
            break;
          }
        }
        nearestMountedAncestor = nearestMountedAncestor.return;
      }
  }
  function attachPingListener(root: RR.FiberRoot | (() => void), wakeable: RR.Wakeable, lanes: RR.Lanes): void {
    var pingCache: RR.PingCache | null = (root as RR.FiberRoot).pingCache;
    if (null === pingCache) {
      pingCache = (root as RR.FiberRoot).pingCache = new PossiblyWeakMap();
      var threadIDs: Set<RR.Lanes> | undefined = new Set();
      pingCache!.set(wakeable, threadIDs);
    } else
      (threadIDs = pingCache.get(wakeable)),
        void 0 === threadIDs &&
          ((threadIDs = new Set()), pingCache.set(wakeable, threadIDs));
    threadIDs.has(lanes) ||
      ((workInProgressRootDidAttachPingListener = !0),
      threadIDs.add(lanes),
      (root = pingSuspendedRoot.bind(null, (root as RR.FiberRoot), wakeable, lanes)),
      wakeable.then(root, root));
  }
  function pingSuspendedRoot(root: RR.FiberRoot, wakeable: RR.Wakeable, pingedLanes: RR.Lanes): void {
    var pingCache: RR.PingCache | null = root.pingCache;
    null !== pingCache && pingCache.delete(wakeable);
    root.pingedLanes |= root.suspendedLanes & pingedLanes;
    root.warmLanes &= ~pingedLanes;
    workInProgressRoot === root &&
      (workInProgressRootRenderLanes & pingedLanes) === pingedLanes &&
      (4 === workInProgressRootExitStatus ||
      (3 === workInProgressRootExitStatus &&
        (workInProgressRootRenderLanes & 62914560) ===
          workInProgressRootRenderLanes &&
        300 > now() - globalMostRecentFallbackTime)
        ? 0 === (executionContext & 2) && prepareFreshStack(root, 0)
        : (workInProgressRootPingedLanes |= pingedLanes),
      workInProgressSuspendedRetryLanes === workInProgressRootRenderLanes &&
        (workInProgressSuspendedRetryLanes = 0));
    ensureRootIsScheduled(root);
  }
  function retryTimedOutBoundary(boundaryFiber: RR.Fiber | RR.FiberRoot | null, retryLane: RR.Lane): void {
    0 === retryLane && (retryLane = claimNextRetryLane());
    boundaryFiber = enqueueConcurrentRenderForLane((boundaryFiber as RR.Fiber), retryLane);
    null !== boundaryFiber &&
      (markRootUpdated$1(boundaryFiber, retryLane),
      ensureRootIsScheduled(boundaryFiber));
  }
  function retryDehydratedSuspenseBoundary(boundaryFiber: RR.Fiber): void {
    var suspenseState: RR.SuspenseState | null = boundaryFiber.memoizedState as RR.SuspenseState | null,
      retryLane: RR.Lane = 0;
    null !== suspenseState && (retryLane = suspenseState.retryLane);
    retryTimedOutBoundary(boundaryFiber, retryLane);
  }
  function resolveRetryWakeable(boundaryFiber: RR.Fiber, wakeable: RR.Wakeable): void {
    var retryLane: RR.Lane = 0;
    switch (boundaryFiber.tag) {
      case 31:
      case 13:
        var retryCache: RR.RetryCache | null = boundaryFiber.stateNode as RR.RetryCache | null;
        var suspenseState: RR.SuspenseState | null = boundaryFiber.memoizedState as RR.SuspenseState | null;
        null !== suspenseState && (retryLane = suspenseState.retryLane);
        break;
      case 19:
        retryCache = boundaryFiber.stateNode as RR.RetryCache | null;
        break;
      case 22:
        retryCache = (boundaryFiber.stateNode as RR.OffscreenInstance)._retryCache;
        break;
      default:
        throw Error(formatProdErrorMessage(314));
    }
    null !== retryCache && retryCache.delete(wakeable);
    retryTimedOutBoundary(boundaryFiber, retryLane);
  }
  function scheduleCallback(priorityLevel: RR.SchedulerPriority, callback: RR.SchedulerCallback): RR.SchedulerTask {
    return scheduleCallback$3(priorityLevel, callback);
  }
  function FiberNode(this: RR.Fiber, tag: RR.WorkTag, pendingProps: RR.Fiber["pendingProps"], key: string | null, mode: RR.TypeOfMode) {
    this.tag = tag;
    this.key = key;
    this.sibling =
      this.child =
      this.return =
      this.stateNode =
      this.type =
      this.elementType =
        null;
    this.index = 0;
    this.refCleanup = this.ref = null;
    this.pendingProps = pendingProps;
    this.dependencies =
      this.memoizedState =
      this.updateQueue =
      this.memoizedProps =
        null;
    this.mode = mode;
    this.subtreeFlags = this.flags = 0;
    this.deletions = null;
    this.childLanes = this.lanes = 0;
    this.alternate = null;
  }
  function shouldConstruct(Component: RR.PrototypeHolder | RR.ClassPrototype | undefined): boolean {
    Component = (Component as RR.PrototypeHolder).prototype;
    return !(!Component || !(Component as RR.ClassPrototype | undefined)!.isReactComponent);
  }
  function createWorkInProgress(current: RR.Fiber, pendingProps: RR.Fiber["pendingProps"] | RR.Dependencies | null): RR.Fiber {
    var workInProgress: RR.Fiber | null = current.alternate;
    null === workInProgress
      ? ((workInProgress = createFiber(
          current.tag,
          pendingProps,
          current.key,
          current.mode
        )),
        (workInProgress.elementType = current.elementType),
        (workInProgress.type = current.type),
        (workInProgress.stateNode = current.stateNode),
        (workInProgress.alternate = current),
        (current.alternate = workInProgress))
      : ((workInProgress.pendingProps = pendingProps),
        (workInProgress.type = current.type),
        (workInProgress.flags = 0),
        (workInProgress.subtreeFlags = 0),
        (workInProgress.deletions = null));
    workInProgress.flags = current.flags & 65011712;
    workInProgress.childLanes = current.childLanes;
    workInProgress.lanes = current.lanes;
    workInProgress.child = current.child;
    workInProgress.memoizedProps = current.memoizedProps;
    workInProgress.memoizedState = current.memoizedState;
    workInProgress.updateQueue = current.updateQueue;
    pendingProps = current.dependencies;
    workInProgress.dependencies =
      null === pendingProps
        ? null
        : {
            lanes: pendingProps.lanes as RR.Lanes,
            firstContext: pendingProps.firstContext
          };
    workInProgress.sibling = current.sibling;
    workInProgress.index = current.index;
    workInProgress.ref = current.ref;
    workInProgress.refCleanup = current.refCleanup;
    return workInProgress;
  }
  function resetWorkInProgress(workInProgress: RR.Fiber, renderLanes: RR.Lanes | RR.Dependencies | null): RR.Fiber {
    workInProgress.flags &= 65011714;
    var current: RR.Fiber | null = workInProgress.alternate;
    null === current
      ? ((workInProgress.childLanes = 0),
        (workInProgress.lanes = (renderLanes as RR.Lanes)),
        (workInProgress.child = null),
        (workInProgress.subtreeFlags = 0),
        (workInProgress.memoizedProps = null),
        (workInProgress.memoizedState = null),
        (workInProgress.updateQueue = null),
        (workInProgress.dependencies = null),
        (workInProgress.stateNode = null))
      : ((workInProgress.childLanes = current.childLanes),
        (workInProgress.lanes = current.lanes),
        (workInProgress.child = current.child),
        (workInProgress.subtreeFlags = 0),
        (workInProgress.deletions = null),
        (workInProgress.memoizedProps = current.memoizedProps),
        (workInProgress.memoizedState = current.memoizedState),
        (workInProgress.updateQueue = current.updateQueue),
        (workInProgress.type = current.type),
        (renderLanes = ((current.dependencies as RR.Dependencies | null | RR.Lanes) as RR.Dependencies | null)),
        (workInProgress.dependencies =
          null === renderLanes
            ? null
            : {
                lanes: renderLanes.lanes,
                firstContext: renderLanes.firstContext
              }));
    return workInProgress;
  }
  function createFiberFromTypeAndProps(
    type: RR.ElementTypeGiven | RR.Fiber,
    key: string | RR.Fiber | null,
    pendingProps: RR.Props | Error,
    owner: RR.Fiber | RR.ElementTypeGiven | null,
    mode: RR.TypeOfMode,
    lanes: RR.Lanes
  ): RR.Fiber {
    var fiberTag: RR.WorkTag = 0;
    owner = (type as RR.ElementTypeGiven);
    if ("function" === typeof type) shouldConstruct(type) && (fiberTag = 1);
    else if ("string" === typeof type)
      fiberTag =
        supportsResources && supportsSingletons
          ? isHostHoistableType!(type, (pendingProps as RR.Props), contextStackCursor.current)
            ? 26
            : isHostSingletonType!(type)
              ? 27
              : 5
          : supportsResources
            ? isHostHoistableType!(
                type,
                (pendingProps as RR.Props),
                contextStackCursor.current
              )
              ? 26
              : 5
            : supportsSingletons
              ? isHostSingletonType!(type)
                ? 27
                : 5
              : 5;
    else
      a: switch ((type as RR.ElementTypeGiven)) {
        case REACT_ACTIVITY_TYPE:
          return (
            (type = createFiber(31, (pendingProps as RR.Props), (key as string | null), mode)),
            (type.elementType = REACT_ACTIVITY_TYPE),
            (type.lanes = lanes),
            type
          );
        case REACT_FRAGMENT_TYPE:
          return createFiberFromFragment(
            (pendingProps as RR.Props).children,
            mode,
            lanes,
            (key as string | null)
          );
        case REACT_STRICT_MODE_TYPE:
          fiberTag = 8;
          mode |= 24;
          break;
        case REACT_PROFILER_TYPE:
          return (
            (type = createFiber(12, (pendingProps as RR.Props), (key as string | null), mode | 2)),
            (type.elementType = REACT_PROFILER_TYPE),
            (type.lanes = lanes),
            type
          );
        case REACT_SUSPENSE_TYPE:
          return (
            (type = createFiber(13, (pendingProps as RR.Props), (key as string | null), mode)),
            (type.elementType = REACT_SUSPENSE_TYPE),
            (type.lanes = lanes),
            type
          );
        case REACT_SUSPENSE_LIST_TYPE:
          return (
            (type = createFiber(19, (pendingProps as RR.Props), (key as string | null), mode)),
            (type.elementType = REACT_SUSPENSE_LIST_TYPE),
            (type.lanes = lanes),
            type
          );
        default:
          if ("object" === typeof type && null !== (type as RR.ElementTypeGiven))
            switch ((type as RR.TypeObjectGiven).$$typeof) {
              case REACT_CONTEXT_TYPE:
                fiberTag = 10;
                break a;
              case REACT_CONSUMER_TYPE:
                fiberTag = 9;
                break a;
              case REACT_FORWARD_REF_TYPE:
                fiberTag = 11;
                break a;
              case REACT_MEMO_TYPE:
                fiberTag = 14;
                break a;
              case REACT_LAZY_TYPE:
                fiberTag = 16;
                owner = null;
                break a;
            }
          fiberTag = 29;
          pendingProps = Error(
            formatProdErrorMessage(
              130,
              null === (type as RR.ElementTypeGiven) ? "null" : typeof type,
              ""
            )
          );
          owner = null;
      }
    key = createFiber(fiberTag, pendingProps, (key as string | null), mode);
    key.elementType = (type as RR.ElementTypeGiven);
    key.type = (owner as RR.ElementTypeGiven) as RR.ElementType;
    key.lanes = lanes;
    return key;
  }
  function createFiberFromFragment(elements: RR.ReactNode | RR.Fiber, mode: RR.TypeOfMode, lanes: RR.Lanes, key: string | null): RR.Fiber {
    elements = createFiber(7, elements, key, mode);
    (elements as RR.Fiber).lanes = lanes;
    return (elements as RR.Fiber);
  }
  function createFiberFromText(content: string | RR.Fiber, mode: RR.TypeOfMode, lanes: RR.Lanes): RR.Fiber {
    content = createFiber(6, (content as string), null, mode);
    content.lanes = lanes;
    return content;
  }
  function createFiberFromDehydratedFragment(dehydratedNode: RR.SuspenseInstance | RR.ActivityInstance): RR.Fiber {
    var fiber: RR.Fiber = createFiber(18, null, null, 0);
    fiber.stateNode = dehydratedNode;
    return fiber;
  }
  function createFiberFromPortal(portal: RR.ReactPortal, mode: RR.TypeOfMode | RR.Fiber, lanes: RR.Lanes): RR.Fiber {
    mode = createFiber(
      4,
      null !== portal.children ? portal.children : [],
      portal.key,
      (mode as RR.TypeOfMode)
    );
    mode.lanes = lanes;
    mode.stateNode = {
      containerInfo: portal.containerInfo,
      pendingChildren: null,
      implementation: portal.implementation
    } as RR.PortalState;
    return mode;
  }
  function FiberRootNode(this: RR.FiberRoot,
    containerInfo: RR.Container,
    tag: RR.RootTag,
    hydrate: boolean,
    identifierPrefix: string,
    onUncaughtError: RR.OnUncaughtError,
    onCaughtError: RR.OnCaughtError,
    onRecoverableError: RR.OnRecoverableError,
    onDefaultTransitionIndicator: RR.OnDefaultTransitionIndicator,
    formState: RR.ReactFormState | null
  ): void {
    this.tag = 1;
    this.containerInfo = containerInfo;
    this.pingCache = this.current = this.pendingChildren = null;
    this.timeoutHandle = noTimeout;
    this.callbackNode =
      this.next =
      this.pendingContext =
      this.context =
      this.cancelPendingCommit =
        null;
    this.callbackPriority = 0;
    this.expirationTimes = createLaneMap<RR.Milliseconds>(-1);
    this.entangledLanes =
      this.shellSuspendCounter =
      this.errorRecoveryDisabledLanes =
      this.expiredLanes =
      this.warmLanes =
      this.pingedLanes =
      this.suspendedLanes =
      this.pendingLanes =
        0;
    this.entanglements = createLaneMap<RR.Lanes>(0);
    this.hiddenUpdates = createLaneMap<RR.ConcurrentUpdate[] | null>(null);
    this.identifierPrefix = identifierPrefix;
    this.onUncaughtError = onUncaughtError;
    this.onCaughtError = onCaughtError;
    this.onRecoverableError = onRecoverableError;
    this.pooledCache = null;
    this.pooledCacheLanes = 0;
    this.formState = formState;
    this.incompleteTransitions = new Map<RR.Transition, unknown>();
  }
  function createFiberRoot(
    containerInfo: RR.Container | RR.FiberRoot,
    tag: RR.RootTag | RR.TypeOfMode | RR.Cache,
    hydrate: boolean,
    initialChildren: RR.ReactNode,
    hydrationCallbacks: unknown,
    isStrictMode: boolean | RR.Fiber,
    identifierPrefix: string,
    formState: RR.ReactFormState | null,
    onUncaughtError: RR.OnUncaughtError,
    onCaughtError: RR.OnCaughtError,
    onRecoverableError: RR.OnRecoverableError,
    onDefaultTransitionIndicator: RR.OnDefaultTransitionIndicator
  ): RR.FiberRoot {
    containerInfo = new FiberRootNode(
      (containerInfo as RR.Container),
      (tag as RR.RootTag),
      hydrate,
      identifierPrefix,
      onUncaughtError,
      onCaughtError,
      onRecoverableError,
      onDefaultTransitionIndicator,
      formState
    );
    tag = 1;
    !0 === (isStrictMode as boolean) && (tag |= 24);
    isStrictMode = createFiber(3, null, null, tag);
    (containerInfo as RR.FiberRoot).current = isStrictMode;
    isStrictMode.stateNode = (containerInfo as RR.FiberRoot);
    tag = createCache();
    tag.refCount++;
    (containerInfo as RR.FiberRoot).pooledCache = tag;
    tag.refCount++;
    isStrictMode.memoizedState = {
      element: initialChildren,
      isDehydrated: hydrate,
      cache: tag
    } as RR.RootState;
    initializeUpdateQueue(isStrictMode);
    return (containerInfo as RR.FiberRoot);
  }
  function getContextForSubtree(parentComponent: RR.ClassInstance | RR.LegacyContext | null | undefined): RR.LegacyContext {
    if (!(parentComponent as RR.ClassInstance | null | undefined)) return emptyContextObject;
    parentComponent = emptyContextObject;
    return parentComponent;
  }
  function findHostInstance(component: RR.ClassInstance | string | RR.Fiber | null): RR.PublicInstance | null {
    var fiber: RR.Fiber | undefined = (component as RR.ClassInstance)._reactInternals;
    if (void 0 === fiber) {
      if ("function" === typeof (component as RR.ClassInstance).render)
        throw Error(formatProdErrorMessage(188));
      component = Object.keys((component as RR.ClassInstance)).join(",");
      throw Error(formatProdErrorMessage(268, component));
    }
    component = findCurrentFiberUsingSlowPath(fiber);
    component = null !== component ? findCurrentHostFiberImpl(component) : null;
    return null === component ? null : getPublicInstance(component.stateNode);
  }
  function updateContainerImpl(
    rootFiber: RR.Fiber,
    lane: RR.Lane,
    element: RR.ReactNode | RR.FiberRoot | null,
    container: RR.FiberRoot | RR.Update,
    parentComponent: RR.ClassInstance | RR.LegacyContext | null | undefined,
    callback: RR.UpdateCallback | null | undefined
  ): void {
    parentComponent = getContextForSubtree((parentComponent as RR.ClassInstance | null | undefined));
    null === (container as RR.FiberRoot).context
      ? ((container as RR.FiberRoot).context = parentComponent)
      : ((container as RR.FiberRoot).pendingContext = parentComponent);
    container = createUpdate(lane);
    container.payload = { element: element } as RR.RootUpdatePayload;
    callback = void 0 === callback ? null : callback;
    null !== callback && (container.callback = callback);
    element = enqueueUpdate(rootFiber, container, lane);
    null !== (element as RR.FiberRoot | null) &&
      (scheduleUpdateOnFiber((element as RR.FiberRoot | null)!, rootFiber, lane),
      entangleTransitions((element as RR.FiberRoot | null)!, rootFiber, lane));
  }
  function markRetryLaneImpl(fiber: RR.Fiber | RR.SuspenseState | null, retryLane: RR.Lane): void {
    fiber = (fiber as RR.Fiber).memoizedState as RR.SuspenseState | null;
    if (null !== fiber && null !== fiber.dehydrated) {
      var a: RR.Lane = fiber.retryLane;
      fiber.retryLane = 0 !== a && a < retryLane ? a : retryLane;
    }
  }
  function markRetryLaneIfNotHydrated(fiber: RR.Fiber | null, retryLane: RR.Lane): void {
    markRetryLaneImpl(fiber!, retryLane);
    (fiber = fiber!.alternate) && markRetryLaneImpl(fiber, retryLane);
  }
  var exports: RR.Reconciler = {};
  ("use strict");
  var React: RR.ReactModule = require("react"),
    Scheduler: RR.SchedulerModule = require("scheduler"),
    assign = Object.assign,
    REACT_LEGACY_ELEMENT_TYPE = Symbol.for("react.element"),
    REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"),
    REACT_PORTAL_TYPE = Symbol.for("react.portal"),
    REACT_FRAGMENT_TYPE = Symbol.for("react.fragment"),
    REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode"),
    REACT_PROFILER_TYPE = Symbol.for("react.profiler"),
    REACT_CONSUMER_TYPE = Symbol.for("react.consumer"),
    REACT_CONTEXT_TYPE = Symbol.for("react.context"),
    REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref"),
    REACT_SUSPENSE_TYPE = Symbol.for("react.suspense"),
    REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list"),
    REACT_MEMO_TYPE = Symbol.for("react.memo"),
    REACT_LAZY_TYPE = Symbol.for("react.lazy");
  Symbol.for("react.scope");
  var REACT_ACTIVITY_TYPE = Symbol.for("react.activity");
  Symbol.for("react.legacy_hidden");
  Symbol.for("react.tracing_marker");
  var REACT_MEMO_CACHE_SENTINEL = Symbol.for("react.memo_cache_sentinel");
  Symbol.for("react.view_transition");
  var MAYBE_ITERATOR_SYMBOL = Symbol.iterator,
    REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference"),
    isArrayImpl = Array.isArray,
    ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
    rendererVersion = $$$config.rendererVersion,
    rendererPackageName = $$$config.rendererPackageName,
    extraDevToolsConfig = $$$config.extraDevToolsConfig,
    getPublicInstance = $$$config.getPublicInstance,
    getRootHostContext = $$$config.getRootHostContext,
    getChildHostContext = $$$config.getChildHostContext,
    prepareForCommit = $$$config.prepareForCommit,
    resetAfterCommit = $$$config.resetAfterCommit,
    createInstance = $$$config.createInstance;
  $$$config.cloneMutableInstance;
  var appendInitialChild = $$$config.appendInitialChild,
    finalizeInitialChildren = $$$config.finalizeInitialChildren,
    shouldSetTextContent = $$$config.shouldSetTextContent,
    createTextInstance = $$$config.createTextInstance;
  $$$config.cloneMutableTextInstance;
  var scheduleTimeout = $$$config.scheduleTimeout,
    cancelTimeout = $$$config.cancelTimeout,
    noTimeout = $$$config.noTimeout,
    isPrimaryRenderer = $$$config.isPrimaryRenderer;
  $$$config.warnsIfNotActing;
  var supportsMutation = $$$config.supportsMutation,
    supportsPersistence = $$$config.supportsPersistence,
    supportsHydration = $$$config.supportsHydration,
    getInstanceFromNode = $$$config.getInstanceFromNode;
  $$$config.beforeActiveInstanceBlur;
  var preparePortalMount = $$$config.preparePortalMount;
  $$$config.prepareScopeUpdate;
  $$$config.getInstanceFromScope;
  var setCurrentUpdatePriority = $$$config.setCurrentUpdatePriority,
    getCurrentUpdatePriority = $$$config.getCurrentUpdatePriority,
    resolveUpdatePriority = $$$config.resolveUpdatePriority;
  $$$config.trackSchedulerEvent;
  $$$config.resolveEventType;
  $$$config.resolveEventTimeStamp;
  var shouldAttemptEagerTransition = $$$config.shouldAttemptEagerTransition,
    detachDeletedInstance = $$$config.detachDeletedInstance;
  $$$config.requestPostPaintCallback;
  var maySuspendCommit = $$$config.maySuspendCommit,
    maySuspendCommitOnUpdate = $$$config.maySuspendCommitOnUpdate,
    maySuspendCommitInSyncRender = $$$config.maySuspendCommitInSyncRender,
    preloadInstance = $$$config.preloadInstance,
    startSuspendingCommit = $$$config.startSuspendingCommit,
    suspendInstance = $$$config.suspendInstance;
  $$$config.suspendOnActiveViewTransition;
  var waitForCommitToBeReady = $$$config.waitForCommitToBeReady;
  $$$config.getSuspendedCommitReason;
  var NotPendingTransition = $$$config.NotPendingTransition,
    HostTransitionContext = $$$config.HostTransitionContext,
    resetFormInstance = $$$config.resetFormInstance;
  $$$config.bindToConsole;
  var supportsMicrotasks = $$$config.supportsMicrotasks,
    scheduleMicrotask = $$$config.scheduleMicrotask,
    supportsTestSelectors = $$$config.supportsTestSelectors,
    findFiberRoot = $$$config.findFiberRoot,
    getBoundingRect = $$$config.getBoundingRect,
    getTextContent = $$$config.getTextContent,
    isHiddenSubtree = $$$config.isHiddenSubtree,
    matchAccessibilityRole = $$$config.matchAccessibilityRole,
    setFocusIfFocusable = $$$config.setFocusIfFocusable,
    setupIntersectionObserver = $$$config.setupIntersectionObserver,
    appendChild = $$$config.appendChild,
    appendChildToContainer = $$$config.appendChildToContainer,
    commitTextUpdate = $$$config.commitTextUpdate,
    commitMount = $$$config.commitMount,
    commitUpdate = $$$config.commitUpdate,
    insertBefore = $$$config.insertBefore,
    insertInContainerBefore = $$$config.insertInContainerBefore,
    removeChild = $$$config.removeChild,
    removeChildFromContainer = $$$config.removeChildFromContainer,
    resetTextContent = $$$config.resetTextContent,
    hideInstance = $$$config.hideInstance,
    hideTextInstance = $$$config.hideTextInstance,
    unhideInstance = $$$config.unhideInstance,
    unhideTextInstance = $$$config.unhideTextInstance;
  $$$config.cancelViewTransitionName;
  $$$config.cancelRootViewTransitionName;
  $$$config.restoreRootViewTransitionName;
  $$$config.cloneRootViewTransitionContainer;
  $$$config.removeRootViewTransitionClone;
  $$$config.measureClonedInstance;
  $$$config.hasInstanceChanged;
  $$$config.hasInstanceAffectedParent;
  $$$config.startViewTransition;
  $$$config.startGestureTransition;
  $$$config.stopViewTransition;
  $$$config.getCurrentGestureOffset;
  $$$config.createViewTransitionInstance;
  var clearContainer = $$$config.clearContainer;
  $$$config.createFragmentInstance;
  $$$config.updateFragmentInstanceFiber;
  $$$config.commitNewChildToFragmentInstance;
  $$$config.deleteChildFromFragmentInstance;
  var cloneInstance = $$$config.cloneInstance,
    createContainerChildSet = $$$config.createContainerChildSet,
    appendChildToContainerChildSet = $$$config.appendChildToContainerChildSet,
    finalizeContainerChildren = $$$config.finalizeContainerChildren,
    replaceContainerChildren = $$$config.replaceContainerChildren,
    cloneHiddenInstance = $$$config.cloneHiddenInstance,
    cloneHiddenTextInstance = $$$config.cloneHiddenTextInstance,
    isSuspenseInstancePending = $$$config.isSuspenseInstancePending,
    isSuspenseInstanceFallback = $$$config.isSuspenseInstanceFallback,
    getSuspenseInstanceFallbackErrorDetails =
      $$$config.getSuspenseInstanceFallbackErrorDetails,
    registerSuspenseInstanceRetry = $$$config.registerSuspenseInstanceRetry,
    canHydrateFormStateMarker = $$$config.canHydrateFormStateMarker,
    isFormStateMarkerMatching = $$$config.isFormStateMarkerMatching,
    getNextHydratableSibling = $$$config.getNextHydratableSibling,
    getNextHydratableSiblingAfterSingleton =
      $$$config.getNextHydratableSiblingAfterSingleton,
    getFirstHydratableChild = $$$config.getFirstHydratableChild,
    getFirstHydratableChildWithinContainer =
      $$$config.getFirstHydratableChildWithinContainer,
    getFirstHydratableChildWithinActivityInstance =
      $$$config.getFirstHydratableChildWithinActivityInstance,
    getFirstHydratableChildWithinSuspenseInstance =
      $$$config.getFirstHydratableChildWithinSuspenseInstance,
    getFirstHydratableChildWithinSingleton =
      $$$config.getFirstHydratableChildWithinSingleton,
    canHydrateInstance = $$$config.canHydrateInstance,
    canHydrateTextInstance = $$$config.canHydrateTextInstance,
    canHydrateActivityInstance = $$$config.canHydrateActivityInstance,
    canHydrateSuspenseInstance = $$$config.canHydrateSuspenseInstance,
    hydrateInstance = $$$config.hydrateInstance,
    hydrateTextInstance = $$$config.hydrateTextInstance,
    hydrateActivityInstance = $$$config.hydrateActivityInstance,
    hydrateSuspenseInstance = $$$config.hydrateSuspenseInstance,
    getNextHydratableInstanceAfterActivityInstance =
      $$$config.getNextHydratableInstanceAfterActivityInstance,
    getNextHydratableInstanceAfterSuspenseInstance =
      $$$config.getNextHydratableInstanceAfterSuspenseInstance,
    commitHydratedInstance = $$$config.commitHydratedInstance,
    commitHydratedContainer = $$$config.commitHydratedContainer,
    commitHydratedActivityInstance = $$$config.commitHydratedActivityInstance,
    commitHydratedSuspenseInstance = $$$config.commitHydratedSuspenseInstance,
    finalizeHydratedChildren = $$$config.finalizeHydratedChildren,
    flushHydrationEvents = $$$config.flushHydrationEvents;
  $$$config.clearActivityBoundary;
  var clearSuspenseBoundary = $$$config.clearSuspenseBoundary;
  $$$config.clearActivityBoundaryFromContainer;
  var clearSuspenseBoundaryFromContainer =
      $$$config.clearSuspenseBoundaryFromContainer,
    hideDehydratedBoundary = $$$config.hideDehydratedBoundary,
    unhideDehydratedBoundary = $$$config.unhideDehydratedBoundary,
    shouldDeleteUnhydratedTailInstances =
      $$$config.shouldDeleteUnhydratedTailInstances;
  $$$config.diffHydratedPropsForDevWarnings;
  $$$config.diffHydratedTextForDevWarnings;
  $$$config.describeHydratableInstanceForDevWarnings;
  var validateHydratableInstance = $$$config.validateHydratableInstance,
    validateHydratableTextInstance = $$$config.validateHydratableTextInstance,
    supportsResources = $$$config.supportsResources,
    isHostHoistableType = $$$config.isHostHoistableType,
    getHoistableRoot = $$$config.getHoistableRoot,
    getResource = $$$config.getResource,
    acquireResource = $$$config.acquireResource,
    releaseResource = $$$config.releaseResource,
    hydrateHoistable = $$$config.hydrateHoistable,
    mountHoistable = $$$config.mountHoistable,
    unmountHoistable = $$$config.unmountHoistable,
    createHoistableInstance = $$$config.createHoistableInstance,
    prepareToCommitHoistables = $$$config.prepareToCommitHoistables,
    mayResourceSuspendCommit = $$$config.mayResourceSuspendCommit,
    preloadResource = $$$config.preloadResource,
    suspendResource = $$$config.suspendResource,
    supportsSingletons = $$$config.supportsSingletons,
    resolveSingletonInstance = $$$config.resolveSingletonInstance,
    acquireSingletonInstance = $$$config.acquireSingletonInstance,
    releaseSingletonInstance = $$$config.releaseSingletonInstance,
    isHostSingletonType = $$$config.isHostSingletonType,
    isSingletonScope = $$$config.isSingletonScope,
    valueStack: any[] = [],
    index$jscomp$0: number = -1,
    emptyContextObject: RR.LegacyContext = {},
    clz32: (x: number) => number = Math.clz32 ? Math.clz32 : clz32Fallback,
    log$1 = Math.log,
    LN2 = Math.LN2,
    nextTransitionUpdateLane: RR.Lane = 256,
    nextTransitionDeferredLane: RR.Lane = 262144,
    nextRetryLane: RR.Lane = 4194304,
    scheduleCallback$3 = Scheduler.unstable_scheduleCallback,
    cancelCallback$1 = Scheduler.unstable_cancelCallback,
    shouldYield = Scheduler.unstable_shouldYield,
    requestPaint = Scheduler.unstable_requestPaint,
    now = Scheduler.unstable_now,
    ImmediatePriority = Scheduler.unstable_ImmediatePriority,
    UserBlockingPriority = Scheduler.unstable_UserBlockingPriority,
    NormalPriority$1 = Scheduler.unstable_NormalPriority,
    IdlePriority = Scheduler.unstable_IdlePriority,
    log = Scheduler.log,
    unstable_setDisableYieldValue = Scheduler.unstable_setDisableYieldValue,
    rendererID: number | null = null,
    injectedHook: RR.DevToolsHook | null = null,
    objectIs: (x: unknown, y: unknown) => boolean = "function" === typeof Object.is ? Object.is : is,
    reportGlobalError: (error: RR.Thrown) => void =
      "function" === typeof reportError
        ? reportError
        : function (error) {
            if (
              "object" === typeof window &&
              "function" === typeof window.ErrorEvent
            ) {
              var event: object = new window.ErrorEvent("error", {
                bubbles: !0,
                cancelable: !0,
                message:
                  "object" === typeof error &&
                  null !== error &&
                  "string" === typeof error.message
                    ? String(error.message)
                    : String(error),
                error: error
              });
              if (!window.dispatchEvent(event)) return;
            } else if (
              "object" === typeof process &&
              "function" === typeof process.emit
            ) {
              process.emit("uncaughtException", error);
              return;
            }
            console.error(error);
          },
    hasOwnProperty = Object.prototype.hasOwnProperty,
    prefix: string | undefined,
    suffix: string | undefined,
    reentry = !1,
    CapturedStacks: WeakMap<object, RR.CapturedValue> = new WeakMap(),
    forkStack: RR.ForkStackEntry[] = [],
    forkStackIndex: number = 0,
    treeForkProvider: RR.Fiber | null = null,
    treeForkCount: number = 0,
    idStack: RR.IdStackEntry[] = [],
    idStackIndex: number = 0,
    treeContextProvider: RR.Fiber | null = null,
    treeContextId: number = 1,
    treeContextOverflow: string = "",
    contextStackCursor: RR.StackCursor<RR.HostContext> = createCursor(null),
    contextFiberStackCursor: RR.StackCursor<RR.Fiber | null> = createCursor(null),
    rootInstanceStackCursor: RR.StackCursor<RR.Container | null> = createCursor(null),
    hostTransitionProviderCursor: RR.StackCursor<RR.Fiber | null> = createCursor(null),
    hydrationParentFiber: RR.Fiber | null = null,
    nextHydratableInstance: RR.HydratableInstance | null = null,
    isHydrating = !1,
    hydrationErrors: RR.CapturedValue[] | null = null,
    rootOrSingletonContext = !1,
    HydrationMismatchException = Error(formatProdErrorMessage(519)),
    valueCursor: RR.StackCursor<RR.ContextValue> = createCursor(null),
    currentlyRenderingFiber$1: RR.Fiber | null = null,
    lastContextDependency: RR.ContextDependency | null = null,
    AbortControllerLocal: RR.AbortControllerConstructor =
      "undefined" !== typeof AbortController
        ? AbortController
        : function (this: RR.AbortControllerLike) {
            var listeners: Array<() => void> = [],
              signal: RR.AbortSignalLike = (this.signal = {
                aborted: !1,
                addEventListener: function (type: string, listener: () => void) {
                  listeners.push(listener);
                }
              });
            this.abort = function () {
              signal.aborted = !0;
              listeners.forEach(function (listener) {
                return listener();
              });
            };
          } as unknown as RR.AbortControllerConstructor,
    scheduleCallback$2 = Scheduler.unstable_scheduleCallback,
    NormalPriority = Scheduler.unstable_NormalPriority,
    CacheContext: RR.ReactContext<RR.Cache | null> = {
      $$typeof: REACT_CONTEXT_TYPE,
      Consumer: null,
      Provider: null,
      _currentValue: null,
      _currentValue2: null,
      _threadCount: 0
    },
    firstScheduledRoot: RR.FiberRoot | null = null,
    lastScheduledRoot: RR.FiberRoot | null = null,
    didScheduleMicrotask = !1,
    mightHavePendingSyncWork = !1,
    isFlushingWork = !1,
    currentEventTransitionLane: RR.Lane = 0,
    currentEntangledListeners: Array<() => unknown> | null = null,
    currentEntangledPendingCount: number = 0,
    currentEntangledLane: RR.Lane = 0,
    currentEntangledActionThenable: RR.EntangledActionThenable | null = null,
    prevOnStartTransitionFinish: RR.SharedInternals["S"] = ReactSharedInternals.S;
  ReactSharedInternals.S = function (transition: RR.Transition, returnValue: RR.TransitionResult) {
    globalMostRecentTransitionTime = now();
    "object" === typeof returnValue &&
      null !== returnValue &&
      "function" === typeof returnValue.then &&
      entangleAsyncAction(transition, returnValue);
    null !== prevOnStartTransitionFinish &&
      prevOnStartTransitionFinish(transition, returnValue);
  };
  var resumedCache: RR.StackCursor<RR.Cache | null> = createCursor(null),
    SuspenseException = Error(formatProdErrorMessage(460)),
    SuspenseyCommitException = Error(formatProdErrorMessage(474)),
    SuspenseActionException = Error(formatProdErrorMessage(542)),
    noopSuspenseyCommitThenable: RR.NoopThenable = { then: function () {} },
    suspendedThenable: RR.Thenable | RR.NoopThenable | null = null,
    thenableState$1: RR.ThenableState | null = null,
    thenableIndexCounter$1: number = 0,
    reconcileChildFibers: RR.ChildReconciler = createChildReconciler(!0),
    mountChildFibers: RR.ChildReconciler = createChildReconciler(!1),
    concurrentQueues: RR.ConcurrentQueuesEntry[] = [],
    concurrentQueuesIndex: number = 0,
    concurrentlyUpdatedLanes: RR.Lanes = 0,
    hasForceUpdate = !1,
    didReadFromEntangledAsyncAction = !1,
    currentTreeHiddenStackCursor: RR.StackCursor<RR.HiddenContext | null> = createCursor(null),
    prevEntangledRenderLanesCursor: RR.StackCursor<RR.Lanes> = createCursor(0),
    suspenseHandlerStackCursor: RR.StackCursor<RR.Fiber | null> = createCursor(null),
    shellBoundary: RR.Fiber | null = null,
    suspenseStackCursor: RR.StackCursor<RR.SuspenseContext> = createCursor(0),
    renderLanes: RR.Lanes = 0,
    currentlyRenderingFiber: RR.Fiber | null = null,
    currentHook: RR.Hook | null = null,
    workInProgressHook: RR.Hook | null = null,
    didScheduleRenderPhaseUpdate = !1,
    didScheduleRenderPhaseUpdateDuringThisPass = !1,
    shouldDoubleInvokeUserFnsInHooksDEV = !1,
    localIdCounter: number = 0,
    thenableIndexCounter: number = 0,
    thenableState: RR.ThenableState | null = null,
    globalClientIdCounter: number = 0,
    ContextOnlyDispatcher: RR.Dispatcher = {
      readContext: readContext,
      use: use,
      useCallback: throwInvalidHookError,
      useContext: throwInvalidHookError,
      useEffect: throwInvalidHookError,
      useImperativeHandle: throwInvalidHookError,
      useLayoutEffect: throwInvalidHookError,
      useInsertionEffect: throwInvalidHookError,
      useMemo: throwInvalidHookError,
      useReducer: throwInvalidHookError,
      useRef: throwInvalidHookError,
      useState: throwInvalidHookError,
      useDebugValue: throwInvalidHookError,
      useDeferredValue: throwInvalidHookError,
      useTransition: throwInvalidHookError,
      useSyncExternalStore: throwInvalidHookError,
      useId: throwInvalidHookError,
      useHostTransitionStatus: throwInvalidHookError,
      useFormState: throwInvalidHookError,
      useActionState: throwInvalidHookError,
      useOptimistic: throwInvalidHookError,
      useMemoCache: throwInvalidHookError,
      useCacheRefresh: throwInvalidHookError
    };
  ContextOnlyDispatcher.useEffectEvent = throwInvalidHookError;
  var HooksDispatcherOnMount: RR.Dispatcher = {
      readContext: readContext,
      use: use,
      useCallback: function (callback, deps) {
        mountWorkInProgressHook().memoizedState = [
          callback,
          void 0 === deps ? null : deps
        ];
        return callback;
      },
      useContext: readContext,
      useEffect: mountEffect,
      useImperativeHandle: function (ref, create, deps) {
        deps = null !== deps && void 0 !== deps ? deps.concat([ref]) : null;
        mountEffectImpl(
          4194308,
          4,
          imperativeHandleEffect.bind(null, create, ref),
          deps
        );
      },
      useLayoutEffect: function (create, deps) {
        return mountEffectImpl(4194308, 4, create, deps);
      },
      useInsertionEffect: function (create, deps) {
        mountEffectImpl(4, 2, create, deps);
      },
      useMemo: function (nextCreate, deps) {
        var hook: RR.Hook = mountWorkInProgressHook();
        deps = void 0 === deps ? null : deps;
        var nextValue: RR.HookState = nextCreate();
        if (shouldDoubleInvokeUserFnsInHooksDEV) {
          setIsStrictModeForDevtools(!0);
          try {
            nextCreate();
          } finally {
            setIsStrictModeForDevtools(!1);
          }
        }
        hook.memoizedState = [nextValue, deps];
        return nextValue;
      },
      useReducer: function (reducer: RR.ReducerInUnion | RR.HookQueue | RR.Dispatch, initialArg, init) {
        var hook: RR.Hook = mountWorkInProgressHook();
        if (void 0 !== init) {
          var initialState: RR.HookState = init(initialArg);
          if (shouldDoubleInvokeUserFnsInHooksDEV) {
            setIsStrictModeForDevtools(!0);
            try {
              init(initialArg);
            } finally {
              setIsStrictModeForDevtools(!1);
            }
          }
        } else initialState = initialArg;
        hook.memoizedState = hook.baseState = initialState;
        reducer = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: (reducer as RR.ReducerInUnion),
          lastRenderedState: initialState
        } as RR.HookQueue;
        hook.queue = reducer;
        reducer = reducer.dispatch = dispatchReducerAction.bind(
          null,
          currentlyRenderingFiber!,
          reducer
        );
        return [hook.memoizedState, reducer];
      },
      useRef: function (initialValue: any | RR.RefObject) {
        var hook: RR.Hook = mountWorkInProgressHook();
        initialValue = { current: initialValue } as RR.RefObject;
        return (hook.memoizedState = (initialValue as RR.RefObject));
      },
      useState: function (initialState: any | RR.Hook) {
        initialState = mountStateImpl(initialState);
        var queue: RR.HookQueue = (initialState as RR.Hook).queue as RR.HookQueue,
          dispatch: RR.Dispatch = dispatchSetState.bind(
            null,
            currentlyRenderingFiber!,
            queue
          );
        queue.dispatch = dispatch;
        return [(initialState as RR.Hook).memoizedState, dispatch];
      },
      useDebugValue: mountDebugValue,
      useDeferredValue: function (value, initialValue) {
        var hook: RR.Hook = mountWorkInProgressHook();
        return mountDeferredValueImpl(hook, value, initialValue);
      },
      useTransition: function () {
        var stateHook: RR.Hook | RR.StartTransition = mountStateImpl(!1);
        stateHook = startTransition.bind(
          null,
          currentlyRenderingFiber!,
          stateHook.queue as RR.HookQueue,
          !0,
          !1
        );
        mountWorkInProgressHook().memoizedState = stateHook;
        return [!1, stateHook];
      },
      useSyncExternalStore: function (
        subscribe,
        getSnapshot,
        getServerSnapshot: (() => any) | RR.HookState | undefined
      ) {
        var fiber: RR.Fiber = currentlyRenderingFiber!,
          hook: RR.Hook = mountWorkInProgressHook();
        if (isHydrating) {
          if (void 0 === (getServerSnapshot as (() => any) | undefined))
            throw Error(formatProdErrorMessage(407));
          getServerSnapshot = (getServerSnapshot as (() => any) | undefined)!();
        } else {
          getServerSnapshot = getSnapshot();
          if (null === workInProgressRoot)
            throw Error(formatProdErrorMessage(349));
          0 !== (workInProgressRootRenderLanes & 127) ||
            pushStoreConsistencyCheck(fiber, getSnapshot, getServerSnapshot);
        }
        hook.memoizedState = getServerSnapshot;
        var inst: RR.StoreInstance = { value: getServerSnapshot, getSnapshot: getSnapshot };
        hook.queue = inst;
        mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [
          subscribe
        ]);
        fiber.flags |= 2048;
        pushSimpleEffect(
          9,
          { destroy: void 0 },
          updateStoreInstance.bind(
            null,
            fiber,
            inst,
            getServerSnapshot,
            getSnapshot
          ),
          null
        );
        return getServerSnapshot;
      },
      useId: function () {
        var hook: RR.Hook = mountWorkInProgressHook(),
          identifierPrefix: string = workInProgressRoot!.identifierPrefix;
        if (isHydrating) {
          var JSCompiler_inline_result: string | number = treeContextOverflow;
          var idWithLeadingBit: number = treeContextId;
          JSCompiler_inline_result =
            (
              idWithLeadingBit & ~(1 << (32 - clz32(idWithLeadingBit) - 1))
            ).toString(32) + JSCompiler_inline_result;
          identifierPrefix =
            "_" + identifierPrefix + "R_" + JSCompiler_inline_result;
          JSCompiler_inline_result = localIdCounter++;
          0 < JSCompiler_inline_result &&
            (identifierPrefix += "H" + JSCompiler_inline_result.toString(32));
          identifierPrefix += "_";
        } else
          (JSCompiler_inline_result = globalClientIdCounter++),
            (identifierPrefix =
              "_" +
              identifierPrefix +
              "r_" +
              JSCompiler_inline_result.toString(32) +
              "_");
        return (hook.memoizedState = identifierPrefix);
      },
      useHostTransitionStatus: useHostTransitionStatus,
      useFormState: mountActionState,
      useActionState: mountActionState,
      useOptimistic: function (passthrough) {
        var hook: RR.Hook | RR.Dispatch = mountWorkInProgressHook();
        hook.memoizedState = hook.baseState = passthrough;
        var queue: RR.HookQueue = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: null,
          lastRenderedState: null
        };
        hook.queue = queue;
        hook = dispatchOptimisticSetState.bind(
          null,
          currentlyRenderingFiber!,
          !0,
          queue
        );
        queue.dispatch = hook;
        return [passthrough, hook];
      },
      useMemoCache: useMemoCache,
      useCacheRefresh: function () {
        return (mountWorkInProgressHook().memoizedState = refreshCache.bind(
          null,
          currentlyRenderingFiber!
        ));
      },
      useEffectEvent: function (callback) {
        var hook: RR.Hook = mountWorkInProgressHook(),
          ref: RR.EventFunctionRef = { impl: callback };
        hook.memoizedState = ref;
        return function () {
          if (0 !== (executionContext & 2))
            throw Error(formatProdErrorMessage(440));
          return ref.impl.apply(void 0, arguments as any);
        };
      }
    },
    HooksDispatcherOnUpdate: RR.Dispatcher = {
      readContext: readContext,
      use: use,
      useCallback: updateCallback,
      useContext: readContext,
      useEffect: updateEffect,
      useImperativeHandle: updateImperativeHandle,
      useInsertionEffect: updateInsertionEffect,
      useLayoutEffect: updateLayoutEffect,
      useMemo: updateMemo,
      useReducer: updateReducer,
      useRef: updateRef,
      useState: function () {
        return updateReducer(basicStateReducer);
      },
      useDebugValue: mountDebugValue,
      useDeferredValue: function (value, initialValue) {
        var hook: RR.Hook = updateWorkInProgressHook();
        return updateDeferredValueImpl(
          hook,
          currentHook!.memoizedState,
          value,
          initialValue
        );
      },
      useTransition: function () {
        var booleanOrThenable: boolean | RR.Thenable<boolean> = updateReducer(basicStateReducer)[0],
          start: RR.StartTransition = updateWorkInProgressHook().memoizedState;
        return [
          "boolean" === typeof booleanOrThenable
            ? booleanOrThenable
            : useThenable(booleanOrThenable),
          start
        ];
      },
      useSyncExternalStore: updateSyncExternalStore,
      useId: updateId,
      useHostTransitionStatus: useHostTransitionStatus,
      useFormState: updateActionState,
      useActionState: updateActionState,
      useOptimistic: function (passthrough, reducer) {
        var hook: RR.Hook = updateWorkInProgressHook();
        return updateOptimisticImpl(hook, currentHook, passthrough, reducer);
      },
      useMemoCache: useMemoCache,
      useCacheRefresh: updateRefresh
    };
  HooksDispatcherOnUpdate.useEffectEvent = updateEvent;
  var HooksDispatcherOnRerender: RR.Dispatcher = {
    readContext: readContext,
    use: use,
    useCallback: updateCallback,
    useContext: readContext,
    useEffect: updateEffect,
    useImperativeHandle: updateImperativeHandle,
    useInsertionEffect: updateInsertionEffect,
    useLayoutEffect: updateLayoutEffect,
    useMemo: updateMemo,
    useReducer: rerenderReducer,
    useRef: updateRef,
    useState: function () {
      return rerenderReducer(basicStateReducer);
    },
    useDebugValue: mountDebugValue,
    useDeferredValue: function (value, initialValue) {
      var hook: RR.Hook = updateWorkInProgressHook();
      return null === currentHook
        ? mountDeferredValueImpl(hook, value, initialValue)
        : updateDeferredValueImpl(
            hook,
            currentHook.memoizedState,
            value,
            initialValue
          );
    },
    useTransition: function () {
      var booleanOrThenable: boolean | RR.Thenable<boolean> = rerenderReducer(basicStateReducer)[0],
        start: RR.StartTransition = updateWorkInProgressHook().memoizedState;
      return [
        "boolean" === typeof booleanOrThenable
          ? booleanOrThenable
          : useThenable(booleanOrThenable),
        start
      ];
    },
    useSyncExternalStore: updateSyncExternalStore,
    useId: updateId,
    useHostTransitionStatus: useHostTransitionStatus,
    useFormState: rerenderActionState,
    useActionState: rerenderActionState,
    useOptimistic: function (passthrough, reducer) {
      var hook: RR.Hook = updateWorkInProgressHook();
      if (null !== currentHook)
        return updateOptimisticImpl(hook, currentHook, passthrough, reducer);
      hook.baseState = passthrough;
      return [passthrough, (hook.queue as RR.HookQueue).dispatch];
    },
    useMemoCache: useMemoCache,
    useCacheRefresh: updateRefresh
  };
  HooksDispatcherOnRerender.useEffectEvent = updateEvent;
  var classComponentUpdater: RR.ClassComponentUpdater = {
      enqueueSetState: function (inst: RR.ClassInstance | RR.Fiber, payload: RR.Payload | RR.FiberRoot | null, callback) {
        inst = (inst as RR.ClassInstance)._reactInternals!;
        var lane = requestUpdateLane(),
          update = createUpdate(lane);
        update.payload = payload;
        void 0 !== callback &&
          null !== callback &&
          (update.callback = callback);
        payload = enqueueUpdate((inst as RR.Fiber), update, lane);
        null !== (payload as RR.FiberRoot | null) &&
          (scheduleUpdateOnFiber((payload as RR.FiberRoot | null)!, inst, lane),
          entangleTransitions((payload as RR.FiberRoot | null)!, inst, lane));
      },
      enqueueReplaceState: function (inst: RR.ClassInstance | RR.Fiber, payload: RR.Payload | RR.FiberRoot | null, callback) {
        inst = (inst as RR.ClassInstance)._reactInternals!;
        var lane = requestUpdateLane(),
          update = createUpdate(lane);
        update.tag = 1;
        update.payload = payload;
        void 0 !== callback &&
          null !== callback &&
          (update.callback = callback);
        payload = enqueueUpdate((inst as RR.Fiber), update, lane);
        null !== (payload as RR.FiberRoot | null) &&
          (scheduleUpdateOnFiber((payload as RR.FiberRoot | null)!, inst, lane),
          entangleTransitions((payload as RR.FiberRoot | null)!, inst, lane));
      },
      enqueueForceUpdate: function (inst: RR.ClassInstance | RR.Fiber, callback: RR.UpdateCallback | RR.FiberRoot | null | undefined) {
        inst = (inst as RR.ClassInstance)._reactInternals!;
        var lane = requestUpdateLane(),
          update = createUpdate(lane);
        update.tag = 2;
        void 0 !== (callback as RR.UpdateCallback | null | undefined) &&
          null !== (callback as RR.UpdateCallback | null | undefined) &&
          (update.callback = (callback as RR.UpdateCallback | null | undefined)!);
        callback = enqueueUpdate((inst as RR.Fiber), update, lane);
        null !== callback &&
          (scheduleUpdateOnFiber(callback, (inst as RR.Fiber), lane),
          entangleTransitions(callback, (inst as RR.Fiber), lane));
      }
    },
    SelectiveHydrationException = Error(formatProdErrorMessage(461)),
    didReceiveUpdate = !1,
    SUSPENDED_MARKER: RR.SuspenseState = {
      dehydrated: null,
      treeContext: null,
      retryLane: 0,
      hydrationErrors: null
    },
    offscreenSubtreeIsHidden = !1,
    offscreenSubtreeWasHidden = !1,
    needsFormReset = !1,
    PossiblyWeakSet: RR.RetryCacheConstructor = "function" === typeof WeakSet ? WeakSet : Set,
    nextEffect: RR.Fiber | null = null,
    hostParent: RR.StateNode = null,
    hostParentIsContainer = !1,
    currentHoistableRoot: RR.HoistableRoot | null = null,
    suspenseyCommitFlag: RR.Flags = 8192,
    DefaultAsyncDispatcher: RR.AsyncDispatcher = {
      getCacheForType: function (resourceType) {
        var cache: RR.Cache = readContext(CacheContext)!,
          cacheForType: RR.CacheEntry = cache.data.get(resourceType);
        void 0 === cacheForType &&
          ((cacheForType = resourceType()),
          cache.data.set(resourceType, cacheForType));
        return cacheForType;
      },
      cacheSignal: function () {
        return (readContext(CacheContext)! as RR.Cache).controller.signal;
      }
    },
    COMPONENT_TYPE: RR.SelectorType = 0,
    HAS_PSEUDO_CLASS_TYPE: RR.SelectorType = 1,
    ROLE_TYPE: RR.SelectorType = 2,
    TEST_NAME_TYPE: RR.SelectorType = 3,
    TEXT_TYPE: RR.SelectorType = 4;
  if ("function" === typeof Symbol && Symbol.for) {
    var symbolFor = Symbol.for;
    COMPONENT_TYPE = symbolFor("selector.component");
    HAS_PSEUDO_CLASS_TYPE = symbolFor("selector.has_pseudo_class");
    ROLE_TYPE = symbolFor("selector.role");
    TEST_NAME_TYPE = symbolFor("selector.test_id");
    TEXT_TYPE = symbolFor("selector.text");
  }
  var PossiblyWeakMap: RR.PingCacheConstructor = "function" === typeof WeakMap ? WeakMap : Map,
    executionContext: RR.ExecutionContext = 0,
    workInProgressRoot: RR.FiberRoot | null = null,
    workInProgress: RR.Fiber | null = null,
    workInProgressRootRenderLanes: RR.Lanes = 0,
    workInProgressSuspendedReason: RR.SuspendedReason = 0,
    workInProgressThrownValue: RR.Thrown = null,
    workInProgressRootDidSkipSuspendedSiblings = !1,
    workInProgressRootIsPrerendering = !1,
    workInProgressRootDidAttachPingListener = !1,
    entangledRenderLanes: RR.Lanes = 0,
    workInProgressRootExitStatus: RR.RootExitStatus = 0,
    workInProgressRootSkippedLanes: RR.Lanes = 0,
    workInProgressRootInterleavedUpdatedLanes: RR.Lanes = 0,
    workInProgressRootPingedLanes: RR.Lanes = 0,
    workInProgressDeferredLane: RR.Lane = 0,
    workInProgressSuspendedRetryLanes: RR.Lanes = 0,
    workInProgressRootConcurrentErrors: RR.CapturedValue[] | null = null,
    workInProgressRootRecoverableErrors: RR.CapturedValue[] | null = null,
    workInProgressRootDidIncludeRecursiveRenderUpdate = !1,
    globalMostRecentFallbackTime: RR.Milliseconds = 0,
    globalMostRecentTransitionTime: RR.Milliseconds = 0,
    workInProgressRootRenderTargetTime: RR.Milliseconds = Infinity,
    workInProgressTransitions: RR.Transition[] | null = null,
    legacyErrorBoundariesThatAlreadyFailed: Set<RR.ClassInstance> | null = null,
    pendingEffectsStatus: RR.PendingEffectsStatus = 0,
    pendingEffectsRoot: RR.FiberRoot | null = null,
    pendingFinishedWork: RR.Fiber | null = null,
    pendingEffectsLanes: RR.Lanes = 0,
    pendingEffectsRemainingLanes: RR.Lanes = 0,
    pendingPassiveTransitions: RR.Transition[] | null = null,
    pendingRecoverableErrors: RR.CapturedValue[] | null = null,
    nestedUpdateCount = 0,
    rootWithNestedUpdates: RR.FiberRoot | null = null;
  exports.attemptContinuousHydration = function (fiber) {
    if (13 === fiber.tag || 31 === fiber.tag) {
      var root = enqueueConcurrentRenderForLane(fiber, 67108864);
      null !== root && scheduleUpdateOnFiber(root, fiber, 67108864);
      markRetryLaneIfNotHydrated(fiber, 67108864);
    }
  };
  exports.attemptHydrationAtCurrentPriority = function (fiber) {
    if (13 === fiber.tag || 31 === fiber.tag) {
      var lane = requestUpdateLane();
      lane = getBumpedLaneForHydrationByLane(lane);
      var root = enqueueConcurrentRenderForLane(fiber, lane);
      null !== root && scheduleUpdateOnFiber(root, fiber, lane);
      markRetryLaneIfNotHydrated(fiber, lane);
    }
  };
  exports.attemptSynchronousHydration = function (fiber: RR.Fiber | RR.FiberRoot) {
    switch ((fiber as RR.Fiber).tag) {
      case 3:
        fiber = (fiber as RR.Fiber).stateNode as RR.FiberRoot;
        if ((fiber.current!.memoizedState as RR.RootState).isDehydrated) {
          var lanes: RR.Lanes | RR.FiberRoot | null = getHighestPriorityLanes(fiber.pendingLanes);
          if (0 !== lanes) {
            fiber.pendingLanes |= 2;
            for (fiber.entangledLanes |= 2; lanes; ) {
              var lane = 1 << (31 - clz32(lanes));
              fiber.entanglements[1]! |= lane;
              lanes &= ~lane;
            }
            ensureRootIsScheduled(fiber);
            0 === (executionContext & 6) &&
              ((workInProgressRootRenderTargetTime = now() + 500),
              flushSyncWorkAcrossRoots_impl(0, !1));
          }
        }
        break;
      case 31:
      case 13:
        (lanes = enqueueConcurrentRenderForLane((fiber as RR.Fiber), 2)),
          null !== lanes && scheduleUpdateOnFiber(lanes, (fiber as RR.Fiber), 2),
          flushSyncWork(),
          markRetryLaneIfNotHydrated((fiber as RR.Fiber), 2);
    }
  };
  exports.batchedUpdates = function (fn, a) {
    return fn(a);
  };
  exports.createComponentSelector = function (component): RR.Selector {
    return { $$typeof: COMPONENT_TYPE, value: component };
  };
  exports.createContainer = function (
    containerInfo,
    tag,
    hydrationCallbacks,
    isStrictMode,
    concurrentUpdatesByDefaultOverride,
    identifierPrefix,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator
  ) {
    return createFiberRoot(
      containerInfo,
      tag as RR.RootTag,
      !1,
      null,
      hydrationCallbacks,
      isStrictMode,
      identifierPrefix,
      null,
      onUncaughtError,
      onCaughtError,
      onRecoverableError,
      onDefaultTransitionIndicator
    );
  };
  exports.createHasPseudoClassSelector = function (selectors): RR.Selector {
    return { $$typeof: HAS_PSEUDO_CLASS_TYPE, value: selectors };
  };
  exports.createHydrationContainer = function (
    initialChildren: RR.ReactNode | RR.FiberRoot,
    callback: RR.UpdateCallback | RR.Lane | null | undefined,
    containerInfo: RR.Container | RR.Fiber,
    tag: RR.RootTag | RR.Lane,
    hydrationCallbacks: RR.Carried | RR.Update,
    isStrictMode,
    concurrentUpdatesByDefaultOverride,
    identifierPrefix,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator,
    transitionCallbacks,
    formState
  ) {
    initialChildren = createFiberRoot(
      (containerInfo as RR.Container),
      tag as RR.RootTag,
      !0,
      initialChildren,
      (hydrationCallbacks as RR.Carried),
      isStrictMode,
      identifierPrefix,
      formState,
      onUncaughtError,
      onCaughtError,
      onRecoverableError,
      onDefaultTransitionIndicator
    );
    (initialChildren as RR.FiberRoot).context = getContextForSubtree(null);
    containerInfo = (initialChildren as RR.FiberRoot).current!;
    tag = requestUpdateLane();
    tag = getBumpedLaneForHydrationByLane(tag);
    hydrationCallbacks = createUpdate(tag);
    (hydrationCallbacks as RR.Update).callback =
      void 0 !== (callback as RR.UpdateCallback | null | undefined) && null !== (callback as RR.UpdateCallback | null | undefined) ? (callback as RR.UpdateCallback) : null;
    enqueueUpdate(containerInfo, hydrationCallbacks, tag);
    callback = tag;
    (initialChildren as RR.FiberRoot).current!.lanes = callback;
    markRootUpdated$1((initialChildren as RR.FiberRoot), callback);
    ensureRootIsScheduled((initialChildren as RR.FiberRoot));
    return (initialChildren as RR.FiberRoot);
  };
  exports.createPortal = function (children, containerInfo, implementation): RR.ReactPortal {
    var key: unknown =
      3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
    return {
      $$typeof: REACT_PORTAL_TYPE,
      key: null == key ? null : "" + key,
      children: children,
      containerInfo: containerInfo,
      implementation: implementation
    };
  };
  exports.createRoleSelector = function (role): RR.Selector {
    return { $$typeof: ROLE_TYPE, value: role };
  };
  exports.createTestNameSelector = function (id): RR.Selector {
    return { $$typeof: TEST_NAME_TYPE, value: id };
  };
  exports.createTextSelector = function (text): RR.Selector {
    return { $$typeof: TEXT_TYPE, value: text };
  };
  exports.defaultOnCaughtError = function (error) {
    console.error(error);
  };
  exports.defaultOnRecoverableError = function (error) {
    reportGlobalError(error);
  };
  exports.defaultOnUncaughtError = function (error) {
    reportGlobalError(error);
  };
  exports.deferredUpdates = function (fn) {
    var prevTransition = ReactSharedInternals.T,
      previousPriority = getCurrentUpdatePriority();
    try {
      return (
        setCurrentUpdatePriority(32), (ReactSharedInternals.T = null), fn()
      );
    } finally {
      setCurrentUpdatePriority(previousPriority),
        (ReactSharedInternals.T = prevTransition);
    }
  };
  exports.discreteUpdates = function (fn, a, b, c, d) {
    var prevTransition = ReactSharedInternals.T,
      previousPriority = getCurrentUpdatePriority();
    try {
      return (
        setCurrentUpdatePriority(2),
        (ReactSharedInternals.T = null),
        fn(a, b, c, d)
      );
    } finally {
      setCurrentUpdatePriority(previousPriority),
        (ReactSharedInternals.T = prevTransition),
        0 === executionContext &&
          (workInProgressRootRenderTargetTime = now() + 500);
    }
  };
  exports.findAllNodes = findAllNodes;
  exports.findBoundingRects = function (hostRoot: RR.Instance | RR.BoundingRect[], selectors: RR.Selector[] | RR.StateNode[] | number) {
    if (!supportsTestSelectors) throw Error(formatProdErrorMessage(363));
    selectors = findAllNodes((hostRoot as RR.Instance), (selectors as RR.Selector[]));
    hostRoot = [];
    for (var i: number | RR.BoundingRect = 0; i < selectors.length; i++)
      hostRoot.push(getBoundingRect!(selectors[i]!));
    for (selectors = hostRoot.length - 1; 0 < selectors; selectors--) {
      i = hostRoot[selectors]!;
      for (
        var targetLeft = i.x,
          targetRight = targetLeft + i.width,
          targetTop = i.y,
          targetBottom = targetTop + i.height,
          j: number = selectors - 1;
        0 <= j;
        j--
      )
        if (selectors !== j) {
          var otherRect = hostRoot[j]!,
            otherLeft = otherRect.x,
            otherRight = otherLeft + otherRect.width,
            otherTop = otherRect.y,
            otherBottom = otherTop + otherRect.height;
          if (
            targetLeft >= otherLeft &&
            targetTop >= otherTop &&
            targetRight <= otherRight &&
            targetBottom <= otherBottom
          ) {
            hostRoot.splice(selectors, 1);
            break;
          } else if (
            !(
              targetLeft !== otherLeft ||
              i.width !== otherRect.width ||
              otherBottom < targetTop ||
              otherTop > targetBottom
            )
          ) {
            otherTop > targetTop &&
              ((otherRect.height += otherTop - targetTop),
              (otherRect.y = targetTop));
            otherBottom < targetBottom &&
              (otherRect.height = targetBottom - otherTop);
            hostRoot.splice(selectors, 1);
            break;
          } else if (
            !(
              targetTop !== otherTop ||
              i.height !== otherRect.height ||
              otherRight < targetLeft ||
              otherLeft > targetRight
            )
          ) {
            otherLeft > targetLeft &&
              ((otherRect.width += otherLeft - targetLeft),
              (otherRect.x = targetLeft));
            otherRight < targetRight &&
              (otherRect.width = targetRight - otherLeft);
            hostRoot.splice(selectors, 1);
            break;
          }
        }
    }
    return hostRoot;
  };
  exports.findHostInstance = findHostInstance;
  exports.findHostInstanceWithNoPortals = function (fiber: RR.Fiber | null) {
    fiber = findCurrentFiberUsingSlowPath((fiber as RR.Fiber));
    fiber =
      null !== fiber ? findCurrentHostFiberWithNoPortalsImpl(fiber) : null;
    return null === fiber ? null : getPublicInstance(fiber.stateNode);
  };
  exports.findHostInstanceWithWarning = function (component) {
    return findHostInstance(component);
  };
  exports.flushPassiveEffects = flushPendingEffects;
  exports.flushSyncFromReconciler = function (fn) {
    var prevExecutionContext = executionContext;
    executionContext |= 1;
    var prevTransition = ReactSharedInternals.T,
      previousPriority = getCurrentUpdatePriority();
    try {
      if ((setCurrentUpdatePriority(2), (ReactSharedInternals.T = null), fn))
        return fn();
    } finally {
      setCurrentUpdatePriority(previousPriority),
        (ReactSharedInternals.T = prevTransition),
        (executionContext = prevExecutionContext),
        0 === (executionContext & 6) && flushSyncWorkAcrossRoots_impl(0, !1);
    }
  };
  exports.flushSyncWork = flushSyncWork;
  exports.focusWithin = function (hostRoot: RR.Instance | RR.Fiber | number, selectors: RR.Selector[] | RR.Fiber[]) {
    if (!supportsTestSelectors) throw Error(formatProdErrorMessage(363));
    hostRoot = findFiberRootForHostRoot((hostRoot as RR.Instance));
    selectors = findPaths(hostRoot, (selectors as RR.Selector[]));
    selectors = Array.from(selectors);
    for (hostRoot = 0; hostRoot < selectors.length; ) {
      var fiber: RR.Fiber | null = selectors[hostRoot++]!,
        tag = fiber.tag;
      if (!isHiddenSubtree!(fiber)) {
        if (
          (5 === tag || 26 === tag || 27 === tag) &&
          setFocusIfFocusable!(fiber.stateNode)
        )
          return !0;
        for (fiber = fiber.child; null !== fiber; )
          selectors.push(fiber), (fiber = fiber.sibling);
      }
    }
    return !1;
  };
  exports.getFindAllNodesFailureDescription = function (hostRoot: RR.Instance | RR.SelectorStackEntry[] | string[], selectors) {
    if (!supportsTestSelectors) throw Error(formatProdErrorMessage(363));
    var maxSelectorIndex = 0,
      matchedNames: string[] = [];
    hostRoot = [findFiberRootForHostRoot((hostRoot as RR.Instance)), 0];
    for (var index = 0; index < hostRoot.length; ) {
      var fiber: RR.Fiber | null = hostRoot[index++] as RR.Fiber,
        tag = fiber.tag,
        selectorIndex = hostRoot[index++] as number,
        selector = selectors[selectorIndex]!;
      if ((5 !== tag && 26 !== tag && 27 !== tag) || !isHiddenSubtree!(fiber))
        if (
          (matchSelector(fiber, selector) &&
            (matchedNames.push(selectorToString(selector)),
            selectorIndex++,
            selectorIndex > maxSelectorIndex &&
              (maxSelectorIndex = selectorIndex)),
          selectorIndex < selectors.length)
        )
          for (fiber = fiber.child; null !== fiber; )
            hostRoot.push(fiber, selectorIndex), (fiber = fiber.sibling);
    }
    if (maxSelectorIndex < selectors.length) {
      for (
        hostRoot = [];
        maxSelectorIndex < selectors.length;
        maxSelectorIndex++
      )
        (hostRoot as string[]).push(selectorToString(selectors[maxSelectorIndex]!));
      return (
        "findAllNodes was able to match part of the selector:\n  " +
        (matchedNames.join(" > ") +
          "\n\nNo matching component was found for:\n  ") +
        (hostRoot as string[]).join(" > ")
      );
    }
    return null;
  };
  exports.getPublicRootInstance = function (container: RR.FiberRoot | RR.Fiber) {
    container = (container as RR.FiberRoot).current!;
    if (!(container as RR.Fiber).child) return null;
    switch ((container as RR.Fiber).child!.tag) {
      case 27:
      case 5:
        return getPublicInstance((container as RR.Fiber).child!.stateNode);
      default:
        return (container as RR.Fiber).child!.stateNode;
    }
  };
  exports.injectIntoDevTools = function () {
    var internals: RR.DevToolsInternals | boolean = {
      bundleType: 0,
      version: rendererVersion,
      rendererPackageName: rendererPackageName,
      currentDispatcherRef: ReactSharedInternals,
      reconcilerVersion: "19.2.0"
    };
    null !== extraDevToolsConfig &&
      (internals.rendererConfig = extraDevToolsConfig);
    if ("undefined" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__) internals = !1;
    else {
      var hook = __REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook.isDisabled || !hook.supportsFiber) internals = !0;
      else {
        try {
          (rendererID = hook.inject(internals)), (injectedHook = hook);
        } catch (err) {}
        internals = hook.checkDCE ? !0 : !1;
      }
    }
    return internals;
  };
  exports.isAlreadyRendering = function () {
    return 0 !== (executionContext & 6);
  };
  exports.observeVisibleRects = function (
    hostRoot: RR.Instance | RR.StateNode[],
    selectors,
    callback,
    options
  ): RR.Disconnectable {
    if (!supportsTestSelectors) throw Error(formatProdErrorMessage(363));
    hostRoot = findAllNodes((hostRoot as RR.Instance), selectors);
    var disconnect: () => void = setupIntersectionObserver!(
      hostRoot,
      callback,
      options
    ).disconnect;
    return {
      disconnect: function () {
        disconnect();
      }
    };
  };
  exports.shouldError = function () {
    return null;
  };
  exports.shouldSuspend = function () {
    return !1;
  };
  exports.startHostTransition = function (
    formFiber,
    pendingState,
    action,
    formData
  ) {
    if (5 !== formFiber.tag) throw Error(formatProdErrorMessage(476));
    var queue: RR.HookQueue = ensureFormComponentIsStateful(formFiber).queue as RR.HookQueue;
    startTransition(
      formFiber,
      queue,
      pendingState,
      NotPendingTransition,
      null === action
        ? noop
        : function () {
            var stateHook: RR.Hook = ensureFormComponentIsStateful(formFiber);
            null === stateHook.next &&
              (stateHook = formFiber.alternate!.memoizedState as RR.Hook);
            dispatchSetStateInternal<RR.FormResetState>(
              formFiber,
              stateHook.next!.queue as RR.HookQueue,
              {},
              requestUpdateLane()
            );
            return action(formData);
          }
    );
  };
  exports.updateContainer = function (
    element,
    container,
    parentComponent,
    callback
  ) {
    var current: RR.Fiber = container.current!,
      lane: RR.Lane = requestUpdateLane();
    updateContainerImpl(
      current,
      lane,
      element,
      container,
      parentComponent,
      callback
    );
    return lane;
  };
  exports.updateContainerSync = function (
    element,
    container,
    parentComponent,
    callback
  ) {
    updateContainerImpl(
      container.current!,
      2,
      element,
      container,
      parentComponent,
      callback
    );
    return 2;
  };
  return exports;
};
module.exports.default = module.exports;
Object.defineProperty(module.exports, "__esModule", { value: !0 });
declare namespace RR {
  type IteratorFn = (this: ReactNode) => Iterator<ReactNode>;
  type AnyElementType = any;
}
declare namespace RR {
  interface ComponentFunction extends Function { displayName?: string }
  type FakeOrResult = any;
  type PrepareStackTrace = (error: Error, structuredStackTrace: unknown[]) => unknown;
  type ComponentFrameStacks = [sample: string | null, control: string | null | undefined];
  interface RootFrameRunner { DetermineComponentFrameRoot: { (): ComponentFrameStacks; displayName?: string } }
}
declare namespace RR {
  interface ThrownObject { readonly $$rrThrown?: never }
  type ThrownInUnion = ThrownObject | string | number | boolean | bigint | symbol | null | undefined;
  type Comparand = any;
  type LazyResult = any;
}
declare namespace RR {
  type ChildReconciler = (returnFiber: Fiber, currentFirstChild: Fiber | null, newChild: ReactNode, lanes: Lanes) => Fiber | null;
  type ExistingChildren = Map<string | number, Fiber>;
  interface ChildIteratorResult { value?: ReactNode; done?: boolean }
  interface ChildIterator { next(): ChildIteratorResult }
}
declare namespace RR {
  type StateUpdater = (this: any, prevState: any, nextProps: any) => any;
}
declare namespace RR {
  interface HookStateObject { readonly $$rrHookState?: never }
  type HookStateInUnion = HookStateObject | string | number | bigint | boolean | symbol | null | undefined;
  interface StoreInstance { pending?: null }
  interface UsableThenable extends Thenable<any> { $$typeof?: undefined }
  interface UsableContext extends ReactContext<any> { then?: never }
  type UsableGiven = UsableThenable | UsableContext;
  type UsedValue = any;
  type StoreSubscribe = (onStoreChange: () => void) => () => void;
  type GetSnapshot = () => any;
  type ActionPayload = any;
}
declare namespace RR {
  type MemoizedPair<T = any> = [value: T, deps: HookDeps | null];
  interface FormResetState {}
}
declare namespace RR {
  type DeriveStateFromProps = (nextProps: any, prevState: any) => ClassState | null | undefined;
  interface PropsWithRef extends Props { ref?: unknown }
  type MemoCompare = (prevProps: any, nextProps: any) => boolean;
}
declare namespace RR {
  interface CarriedObject { readonly $$rrCarried?: never }
  type Carried = CarriedObject | string | number | bigint | boolean | symbol | null | undefined;
}
declare namespace RR {
  interface GivenObject { readonly $$rrGiven?: never }
  type Given = GivenObject | string | number | bigint | boolean | symbol | null | undefined;
}
declare namespace RR {
  interface AnythingObject { readonly $$rrAnything?: never }
  type Anything = AnythingObject | string | number | bigint | boolean | symbol | null | undefined;
  type ResolvedLazy = Exclude<ElementType, string | symbol>;
  type PropsOrChildren = any;
}
declare namespace RR {
  type PropsInUnion = Props | string | number | bigint | boolean | symbol | null | undefined;
  type PropsArg = unknown;
  type CompleteWorkCurrent = Fiber | HostContext | Instance | SuspenseState | FiberUpdateQueue | Lanes | boolean | null;
  type CompleteWorkRenderLanes = Lanes | FiberRoot | HostContext | MemoizedState | CapturedValue[] | Fiber | OffscreenQueue | Cache | boolean | null;
  type CompleteWorkNewProps = PropsInUnion | Cache | SuspenseState | SuspenseListRenderState | Fiber;
  type CompleteWorkType = ElementType | Fiber | SuspenseState | SuspenseInstance | CapturedValue[] | Cache | boolean | null;
  type CompleteWorkNextResource = MemoizedState | Props | HostContext | Cache | Fiber | null;
}
declare namespace RR {
  interface SnapshotObject { readonly $$rrSnapshot?: never }
  type Snapshot = SnapshotObject | string | number | bigint | boolean | symbol | null | undefined;
}
declare namespace RR {
  type SelectorStackEntry = Fiber | number;
}
declare namespace RR {
  type ScheduleCommit = (initiateCommit: () => unknown) => () => void;
  type SuspendedCommitReason = string | null;
}
declare namespace RR {
  interface PrototypeHolder extends Function { prototype: ClassPrototype | undefined }
  interface TypeObjectGiven { $$typeof?: unknown }
  type ElementTypeGiven = ElementType | TypeObjectGiven | number | bigint | boolean | undefined;
}
declare namespace RR {
  type TransitionResult = any;
  type ReducerInUnion = (state: any, action: any) => HookStateInUnion;
}
declare namespace RR {
  type CacheEntry = any;
  type SelectorStackOrNames = Array<SelectorStackEntry | string>;
}
declare var module: { exports: any };
declare function require(name: string): any;
declare var console: { error(...data: any[]): void };
declare function setTimeout(handler: () => void, timeout?: number): RR.TimeoutHandle;
declare var reportError: (error: any) => void;
declare var window: RR.WindowLike;
declare var process: RR.ProcessLike;
declare var AbortController: RR.AbortControllerConstructor;
declare var __REACT_DEVTOOLS_GLOBAL_HOOK__: RR.DevToolsHook;
declare namespace RR {
  type int32 = import("bun").int32;
  type Lane = int32;
  type Lanes = int32;
  type LaneMap<T> = T[];
  type Flags = int32;
  type WorkTag = int32;
  type TypeOfMode = number;
  type HookFlags = int32;
  type RootTag = number;
  type UpdateTag = int32;
  type EventPriority = number;
  type SchedulerPriority = number;
  type ExecutionContext = int32;
  type RootExitStatus = int32;
  type SuspendedReason = int32;
  type PendingEffectsStatus = int32;
  type SuspenseContext = int32;
  type OffscreenVisibility = number;
  type Milliseconds = number;
  type ReactNode = any;
  type ContextValue = any;
  type HookState = any;
  type Payload = any;
  type Thrown = any;
  interface HostObject { readonly $$rrHost?: never }
  interface ClassState { readonly $$rrState?: never }
  type Instance = HostObject;
  type TextInstance = HostObject;
  type SuspenseInstance = HostObject;
  type ActivityInstance = HostObject;
  type HydratableInstance = HostObject;
  type FormInstance = HostObject;
  type PublicInstance = HostObject;
  type Container = HostObject;
  type ChildSet = HostObject;
  type HoistableRoot = HostObject;
  type Resource = HostObject;
  type SuspendedState = HostObject;
  type UpdatePayload = HostObject;
  type HostContext = HostObject | number | string | null;
  type TransitionStatus = HostObject | null;
  type TimeoutHandle = HostObject | number;
  type NoTimeout = number;
  interface LegacyContext { readonly $$rrContext?: never }
  interface Props { [name: string]: unknown }
  type State = MemoizedState;
  type HostArg = StateNode;
  type ResourceArg = MemoizedState;
  type HostType = ElementType;
  interface Fiber {
    tag: WorkTag;
    key: string | null;
    elementType: any;
    type: ElementType;
    stateNode: StateNode;
    return: Fiber | null;
    child: Fiber | null;
    sibling: Fiber | null;
    index: number;
    ref: Ref;
    refCleanup: RefCleanup;
    pendingProps: any;
    memoizedProps: any;
    updateQueue: FiberUpdateQueue;
    memoizedState: MemoizedState;
    dependencies: Dependencies | null;
    mode: TypeOfMode;
    flags: Flags;
    subtreeFlags: Flags;
    deletions: Fiber[] | null;
    lanes: Lanes;
    childLanes: Lanes;
    alternate: Fiber | null;
  }
  type MemoizedState = Hook | RootState | SuspenseState | SuspenseListRenderState | OffscreenState | CacheComponentState | ClassState | Resource | null;
  type FiberUpdateQueue = UpdateQueue | FunctionComponentUpdateQueue | OffscreenQueue | RetryQueue | null;
  type StateNode = FiberRoot | ClassInstance | PortalState | OffscreenInstance | RetryCache | ProfilerState | HostObject | null;
  interface FiberRoot {
    tag: RootTag;
    containerInfo: Container;
    pendingChildren: ChildSet | null;
    current: Fiber | null;
    pingCache: PingCache | null;
    timeoutHandle: TimeoutHandle | NoTimeout;
    cancelPendingCommit: (() => void) | null;
    context: LegacyContext | null;
    pendingContext: LegacyContext | null;
    next: FiberRoot | null;
    callbackNode: SchedulerTask | null;
    callbackPriority: Lane;
    expirationTimes: LaneMap<Milliseconds>;
    pendingLanes: Lanes;
    suspendedLanes: Lanes;
    pingedLanes: Lanes;
    warmLanes: Lanes;
    expiredLanes: Lanes;
    errorRecoveryDisabledLanes: Lanes;
    shellSuspendCounter: number;
    entangledLanes: Lanes;
    entanglements: LaneMap<Lanes>;
    hiddenUpdates: LaneMap<ConcurrentUpdate[] | null>;
    identifierPrefix: string;
    onUncaughtError: OnUncaughtError;
    onCaughtError: OnCaughtError;
    onRecoverableError: OnRecoverableError;
    pooledCache: Cache | null;
    pooledCacheLanes: Lanes;
    formState: ReactFormState | null;
    incompleteTransitions: Map<Transition, unknown>;
  }
  type OnUncaughtError = (error: Thrown, errorInfo: ErrorInfo) => void;
  type OnCaughtError = (error: Thrown, errorInfo: CaughtErrorInfo) => void;
  type OnRecoverableError = (error: Thrown, errorInfo: ErrorInfo) => void;
  type OnDefaultTransitionIndicator = () => void | (() => void);
  interface ErrorInfo { componentStack: string | null }
  interface CaughtErrorInfo { componentStack: string | null; errorBoundary: StateNode }
  type ReactFormState = [state: any, keyPath: string, referenceId: string | null, boundArgumentCount: number];
  type PingCache = WeakMap<Wakeable, Set<Lanes>>;
  interface PingCacheConstructor { new (): PingCache }
  interface RootState { element: ReactNode; isDehydrated: boolean; cache: Cache }
  interface RootUpdatePayload { element: ReactNode }
  interface Update { lane: Lane; tag: UpdateTag; payload: Payload; callback: UpdateCallback | null; next: Update | null }
  type UpdateCallback = (this: any) => unknown;
  interface SharedQueue { pending: Update | null; lanes: Lanes; hiddenCallbacks: UpdateCallback[] | null }
  interface UpdateQueue {
    baseState: MemoizedState;
    firstBaseUpdate: Update | null;
    lastBaseUpdate: Update | null;
    shared: SharedQueue;
    callbacks: UpdateCallback[] | null;
  }
  interface ConcurrentUpdate { lane: Lane; next: ConcurrentUpdate | null }
  interface ConcurrentQueue { pending: ConcurrentUpdate | null }
  type ConcurrentQueuesEntry = any;
  interface Hook {
    memoizedState: HookState;
    baseState: HookState;
    baseQueue: HookUpdate | null;
    queue: any;
    next: Hook | null;
  }
  interface HookUpdate {
    lane: Lane;
    revertLane: Lane;
    gesture: null;
    action: HookState;
    hasEagerState: boolean;
    eagerState: HookState;
    next: HookUpdate | null;
  }
  interface HookQueue {
    pending: HookUpdate | null;
    lanes: Lanes;
    dispatch: Dispatch | null;
    lastRenderedReducer: Reducer | null;
    lastRenderedState: HookState;
  }
  type Dispatch = (action?: any) => void;
  type Reducer = (state: any, action: any) => any;
  type HookDeps = any[];
  type EffectDestroy = () => void;
  type EffectCreate = () => EffectDestroy | void;
  interface Effect { tag: HookFlags; create: EffectCreate; deps: HookDeps | null; inst: EffectInstance; next: Effect | null }
  interface EffectInstance { destroy: EffectDestroy | void }
  interface FunctionComponentUpdateQueue {
    lastEffect: Effect | null;
    events: EventFunctionPayload[] | null;
    stores: StoreConsistencyCheck[] | null;
    memoCache: MemoCache | null;
  }
  interface MemoCache { data: any[][]; index: number }
  interface EventFunctionRef { impl: (...args: any[]) => any }
  interface EventFunctionPayload { ref: EventFunctionRef; nextImpl: (...args: any[]) => any }
  interface StoreConsistencyCheck { getSnapshot: () => any; value: any }
  interface StoreInstance { value: any; getSnapshot: () => any }
  type ActionFn = (state: any, payload: any) => any;
  interface ActionStateQueue { state: any; dispatch: Dispatch | null; action: ActionFn | null; pending: ActionStateQueueNode | null }
  interface ActionStateQueueNode {
    payload: any;
    action: ActionFn;
    next: ActionStateQueueNode | null;
    isTransition: boolean;
    status: ThenableStatus;
    value: any;
    reason: Thrown;
    listeners: Array<(value?: any) => unknown>;
    then(listener: (value?: any) => unknown): void;
  }
  interface RefObject { current: any }
  type RefCallback = (instance: any) => void | (() => void);
  type Ref = RefCallback | RefObject | null;
  type RefCleanup = (() => void) | void | null;
  type DispatchTuple = [state: any, dispatch: Dispatch | null];
  type StartTransition = (callback: () => unknown) => void;
  type TransitionTuple = [isPending: boolean, start: StartTransition];
  type ActionStateTuple = [state: any, dispatch: Dispatch | null, isPending: boolean];
  type Usable = Thenable<any> | ReactContext<any>;
  interface Dispatcher {
    readContext<T>(context: ReactContext<T>): T;
    use(usable: Usable): any;
    useCallback(callback: any, deps: HookDeps | null | undefined): any;
    useContext<T>(context: ReactContext<T>): T;
    useEffect(create: EffectCreate, deps: HookDeps | null | undefined): void;
    useImperativeHandle(ref: Ref | undefined, create: () => any, deps: HookDeps | null | undefined): void;
    useLayoutEffect(create: EffectCreate, deps: HookDeps | null | undefined): void;
    useInsertionEffect(create: EffectCreate, deps: HookDeps | null | undefined): void;
    useMemo(nextCreate: () => any, deps: HookDeps | null | undefined): any;
    useReducer(reducer: Reducer, initialArg: any, init?: (initialArg: any) => any): DispatchTuple;
    useRef(initialValue: any): RefObject;
    useState(initialState?: any): DispatchTuple;
    useDebugValue(value?: any, formatterFn?: (value: any) => any): void;
    useDeferredValue(value: any, initialValue?: any): any;
    useTransition(): TransitionTuple;
    useSyncExternalStore(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => any, getServerSnapshot?: () => any): any;
    useId(): string;
    useHostTransitionStatus(): TransitionStatus;
    useFormState(action: ActionFn, initialState: any, permalink?: string): ActionStateTuple;
    useActionState(action: ActionFn, initialState: any, permalink?: string): ActionStateTuple;
    useOptimistic(passthrough: any, reducer?: Reducer | null): DispatchTuple;
    useMemoCache(size: number): any[];
    useCacheRefresh(): () => void;
    useEffectEvent?(callback: (...args: any[]) => any): (...args: any[]) => any;
  }
  interface AsyncDispatcher { getCacheForType<T>(resourceType: () => T): T; cacheSignal(): AbortSignalLike }
  interface ClassComponentUpdater {
    enqueueSetState(inst: ClassInstance, payload: Payload, callback?: UpdateCallback | null): void;
    enqueueReplaceState(inst: ClassInstance, payload: Payload, callback?: UpdateCallback | null): void;
    enqueueForceUpdate(inst: ClassInstance, callback?: UpdateCallback | null): void;
  }
  interface ContextDependency { context: ReactContext<any>; memoizedValue: ContextValue; next: ContextDependency | null }
  interface Dependencies { lanes: Lanes; firstContext: ContextDependency | null }
  interface ReactContext<T = any> {
    $$typeof: symbol;
    Consumer: ConsumerType | null;
    Provider: ReactContext<T> | null;
    _currentValue: T;
    _currentValue2: T;
    _threadCount: number;
    displayName?: string;
  }
  interface Cache { controller: AbortControllerLike; data: Map<() => unknown, unknown>; refCount: number }
  interface CacheComponentState { parent: Cache | null; cache: Cache | null }
  interface CacheUpdatePayload { cache: Cache }
  interface SpawnedCachePool { parent: Cache | null; pool: Cache | null }
  interface AbortSignalLike { aborted: boolean; addEventListener(type: string, listener: () => void): void }
  interface AbortControllerLike { signal: AbortSignalLike; abort(): void }
  interface AbortControllerConstructor { new (): AbortControllerLike }
  interface Transition { types?: string[] | null | undefined }
  interface TreeContext { id: number; overflow: string }
  interface SuspenseState {
    dehydrated: SuspenseInstance | ActivityInstance | null;
    treeContext: TreeContext | null;
    retryLane: Lane;
    hydrationErrors: CapturedValue[] | null;
  }
  type ActivityState = SuspenseState;
  interface OffscreenState { baseLanes: Lanes; cachePool: SpawnedCachePool | null }
  type HiddenContext = OffscreenState;
  interface OffscreenInstance {
    _visibility: OffscreenVisibility;
    _pendingMarkers: null;
    _retryCache: RetryCache | null;
    _transitions: null;
  }
  interface OffscreenQueue { transitions: null; markerInstances: null; retryQueue: RetryQueue | null }
  type RetryQueue = Set<Wakeable>;
  type RetryCache = WeakSet<Wakeable>;
  interface RetryCacheConstructor { new (): RetryCache }
  type SuspenseListTailMode = string | undefined;
  interface SuspenseListRenderState {
    isBackwards: boolean;
    rendering: Fiber | null;
    renderingStartTime: Milliseconds;
    last: Fiber | null;
    tail: Fiber | null;
    tailMode: SuspenseListTailMode;
    treeForkCount: number;
    lastEffect?: null;
  }
  interface ProfilerState { effectDuration: number; passiveEffectDuration: number }
  interface OffscreenProps { mode: unknown; children: ReactNode }
  interface SuspenseProps { children?: ReactNode; fallback?: ReactNode }
  interface ActivityProps { mode?: unknown; children?: ReactNode }
  interface SuspenseListProps { revealOrder?: unknown; tail?: SuspenseListTailMode; children?: ReactNode }
  interface ProviderProps { value?: ContextValue; children?: ReactNode }
  interface ConsumerProps { children: (value: ContextValue) => ReactNode }
  interface ProfilerProps { id?: string; onPostCommit?: unknown; children?: ReactNode }
  type ThenableStatus = "pending" | "fulfilled" | "rejected";
  interface Wakeable { then(onFulfill: () => unknown, onReject: () => unknown): unknown }
  interface Thenable<T = any> {
    then(onFulfill: (value: T) => unknown, onReject: (error: Thrown) => unknown): unknown;
    status?: string;
    value?: T;
    reason?: Thrown;
  }
  type ThenableState = Thenable<any>[];
  interface EntangledActionThenable { status: ThenableStatus; value: undefined; then(resolve: () => unknown): void }
  interface ChainedThenable<T = any> { status: ThenableStatus; value: T | null; reason: Thrown; then(resolve: (value?: T) => unknown): void }
  interface RejectedThenable { then(): void; status: "rejected"; reason: Thrown }
  interface NoopThenable { then(): void }
  interface StackCursor<T> { current: T }
  interface CapturedValue { value: Thrown; source: Fiber | null; stack: string | null }
  type ForkStackEntry = Fiber | number | null;
  type IdStackEntry = Fiber | number | string | null;
  interface PortalState { containerInfo: Container; pendingChildren: ChildSet | null; implementation: unknown }
  type ComponentFrameSample = [sample: string | null, control: string | null];
  interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } }
  interface ReactElement { $$typeof: symbol; type: any; key: string | null; ref: any; props: any }
  interface ReactPortal { $$typeof: symbol; key: string | null; children: ReactNode; containerInfo: Container; implementation: unknown }
  interface LazyComponent { $$typeof: symbol; _payload: any; _init: (payload: any) => any }
  interface ForwardRefType { $$typeof: symbol; render: FunctionComponent; displayName?: string }
  interface MemoType { $$typeof: symbol; type: ElementType; compare: ((prevProps: any, nextProps: any) => boolean) | null; displayName?: string }
  interface ConsumerType { $$typeof: symbol; _context: ReactContext<any> }
  interface FunctionComponent { (props: any, secondArg?: any): ReactNode; defaultProps?: Props; displayName?: string }
  interface ClassPrototype { isReactComponent?: unknown; isPureReactComponent?: boolean }
  interface ClassComponent {
    new (props: any, context: any): ClassInstance;
    prototype: ClassPrototype;
    contextType?: ReactContext<any> | null;
    defaultProps?: Props;
    displayName?: string;
    getDerivedStateFromProps?: GetDerivedStateFromProps | null;
    getDerivedStateFromError?: ((error: Thrown) => any) | null;
  }
  type GetDerivedStateFromProps = (nextProps: any, prevState: any) => any;
  type ElementType = string | symbol | FunctionComponent | ClassComponent | ReactContext<any> | ConsumerType | ForwardRefType | MemoType | LazyComponent | null;
  interface ClassInstance {
    props: any;
    context: any;
    refs: any;
    updater: ClassComponentUpdater;
    state?: any;
    _reactInternals?: Fiber;
    __reactInternalSnapshotBeforeUpdate?: any;
    render(): ReactNode;
    componentDidMount?(): void;
    componentDidUpdate?(prevProps: any, prevState: any, snapshot: any): void;
    componentWillUnmount?(): void;
    componentDidCatch?(error: Thrown, errorInfo: ErrorInfo): void;
    shouldComponentUpdate?(nextProps: any, nextState: any, nextContext: any): boolean;
    getSnapshotBeforeUpdate?(prevProps: any, prevState: any): any;
    componentWillMount?(): void;
    UNSAFE_componentWillMount?(): void;
    componentWillReceiveProps?(nextProps: any, nextContext: any): void;
    UNSAFE_componentWillReceiveProps?(nextProps: any, nextContext: any): void;
    componentWillUpdate?(nextProps: any, nextState: any, nextContext: any): void;
    UNSAFE_componentWillUpdate?(nextProps: any, nextState: any, nextContext: any): void;
  }
  interface SharedInternals {
    H: Dispatcher | null;
    A: AsyncDispatcher | null;
    T: Transition | null;
    S: ((transition: Transition, returnValue: unknown) => void) | null;
  }
  interface ReactModule { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: SharedInternals }
  type SchedulerCallback = (didTimeout: boolean) => SchedulerCallback | null | undefined | void;
  interface SchedulerTask {
    id: number;
    callback: SchedulerCallback | null;
    priorityLevel: SchedulerPriority;
    startTime: Milliseconds;
    expirationTime: Milliseconds;
    sortIndex: number;
  }
  interface SchedulerModule {
    unstable_scheduleCallback(priorityLevel: SchedulerPriority, callback: SchedulerCallback, options?: { delay: number }): SchedulerTask;
    unstable_cancelCallback(task: SchedulerTask): void;
    unstable_shouldYield(): boolean;
    unstable_requestPaint(): void;
    unstable_now(): Milliseconds;
    unstable_ImmediatePriority: SchedulerPriority;
    unstable_UserBlockingPriority: SchedulerPriority;
    unstable_NormalPriority: SchedulerPriority;
    unstable_IdlePriority: SchedulerPriority;
    log?: unknown;
    unstable_setDisableYieldValue?(newValue: boolean): void;
  }
  interface DevToolsHook {
    isDisabled?: boolean;
    supportsFiber?: boolean;
    checkDCE?: unknown;
    inject(internals: DevToolsInternals): number;
    onCommitFiberRoot?(rendererID: number | null, root: FiberRoot, schedulerPriority: undefined, didError: boolean): void;
    onPostCommitFiberRoot?(rendererID: number | null, root: FiberRoot): void;
    onCommitFiberUnmount?(rendererID: number | null, fiber: Fiber): void;
    setStrictMode?(rendererID: number | null, isStrict: boolean): void;
  }
  interface DevToolsInternals {
    bundleType: number;
    version: string | undefined;
    rendererPackageName: string | undefined;
    currentDispatcherRef: SharedInternals;
    reconcilerVersion: string;
    rendererConfig?: unknown;
  }
  type SelectorType = symbol | number;
  interface Selector { $$typeof: SelectorType; value: any }
  interface BoundingRect { x: number; y: number; width: number; height: number }
  interface IntersectionObserverOptionsLike { root?: unknown; rootMargin?: string; threshold?: number | number[] }
  type ObserveVisibleRectsCallback = (intersections: Array<{ ratio: number; rect: BoundingRect }>) => void;
  interface Disconnectable { disconnect(): void }
  interface ErrorEventInitLike { bubbles: boolean; cancelable: boolean; message: string; error: Thrown }
  interface WindowLike { ErrorEvent: new (type: string, init: ErrorEventInitLike) => object; dispatchEvent(event: object): boolean }
  interface ProcessLike { emit(name: string, error: Thrown): unknown }
  interface HostConfig {
    rendererVersion?: string;
    rendererPackageName?: string;
    extraDevToolsConfig?: unknown;
    getPublicInstance(instance: HostArg): PublicInstance;
    getRootHostContext(rootContainer: Container): HostContext;
    getChildHostContext(parentHostContext: HostContext, type: HostType): HostContext;
    prepareForCommit(containerInfo: Container): unknown;
    resetAfterCommit(containerInfo: Container): void;
    createInstance(type: HostType, props: any, rootContainer: Container | null, hostContext: HostContext, internalHandle: Fiber): Instance;
    cloneMutableInstance?: unknown;
    appendInitialChild(parentInstance: HostArg, child: HostArg): void;
    finalizeInitialChildren(instance: HostArg, type: HostType, props: any, hostContext: HostContext): boolean;
    shouldSetTextContent(type: HostType, props: any): boolean;
    createTextInstance(text: string, rootContainer: Container | null, hostContext: HostContext, internalHandle: Fiber): TextInstance;
    cloneMutableTextInstance?: unknown;
    scheduleTimeout(fn: (...args: any[]) => unknown, delay?: Milliseconds): TimeoutHandle;
    cancelTimeout(id: TimeoutHandle): void;
    noTimeout: NoTimeout;
    isPrimaryRenderer: boolean;
    warnsIfNotActing?: unknown;
    supportsMutation: boolean;
    supportsPersistence: boolean;
    supportsHydration: boolean;
    getInstanceFromNode(node: HostArg): Fiber | null | undefined;
    beforeActiveInstanceBlur?: unknown;
    preparePortalMount(containerInfo: Container): void;
    prepareScopeUpdate?: unknown;
    getInstanceFromScope?: unknown;
    setCurrentUpdatePriority(newPriority: EventPriority): void;
    getCurrentUpdatePriority(): EventPriority;
    resolveUpdatePriority(): EventPriority;
    trackSchedulerEvent?: unknown;
    resolveEventType?: unknown;
    resolveEventTimeStamp?: unknown;
    shouldAttemptEagerTransition(): boolean;
    detachDeletedInstance(node: HostArg): void;
    requestPostPaintCallback?: unknown;
    maySuspendCommit(type: HostType, props: any): boolean;
    maySuspendCommitOnUpdate?(type: HostType, oldProps: any, newProps: any): boolean;
    maySuspendCommitInSyncRender?(type: HostType, props: any): boolean;
    preloadInstance(instance: HostArg, type: HostType, props: any): boolean;
    startSuspendingCommit(): SuspendedState;
    suspendInstance(state: SuspendedState, instance: HostArg, type: HostType, props: any): void;
    suspendOnActiveViewTransition?: unknown;
    waitForCommitToBeReady(state: SuspendedState, timeoutOffset: Milliseconds): ((initiateCommit: () => unknown) => () => void) | null;
    getSuspendedCommitReason?: unknown;
    NotPendingTransition: TransitionStatus;
    HostTransitionContext: ReactContext<TransitionStatus>;
    resetFormInstance(form: HostArg): void;
    bindToConsole?: unknown;
    supportsMicrotasks?: boolean;
    scheduleMicrotask?(fn: () => unknown): void;
    supportsTestSelectors?: boolean;
    findFiberRoot?(node: HostArg): Fiber | null;
    getBoundingRect?(node: HostArg): BoundingRect;
    getTextContent?(fiber: Fiber): string | null;
    isHiddenSubtree?(fiber: Fiber): boolean;
    matchAccessibilityRole?(node: HostArg, role: string): boolean;
    setFocusIfFocusable?(node: HostArg): boolean;
    setupIntersectionObserver?(targets: HostArg[], callback: ObserveVisibleRectsCallback, options?: IntersectionObserverOptionsLike): Disconnectable;
    appendChild?(parentInstance: HostArg, child: HostArg): void;
    appendChildToContainer?(container: HostArg, child: HostArg): void;
    commitTextUpdate?(textInstance: HostArg, oldText: string, newText: string): void;
    commitMount?(instance: HostArg, type: HostType, props: any, internalHandle: Fiber): void;
    commitUpdate?(instance: HostArg, type: HostType, prevProps: any, nextProps: any, internalHandle: Fiber): void;
    insertBefore?(parentInstance: HostArg, child: HostArg, beforeChild: HostArg): void;
    insertInContainerBefore?(container: HostArg, child: HostArg, beforeChild: HostArg): void;
    removeChild?(parentInstance: HostArg, child: HostArg): void;
    removeChildFromContainer?(container: HostArg, child: HostArg): void;
    resetTextContent?(instance: HostArg): void;
    hideInstance?(instance: HostArg): void;
    hideTextInstance?(textInstance: HostArg): void;
    unhideInstance?(instance: HostArg, props: any): void;
    unhideTextInstance?(textInstance: HostArg, text: string): void;
    cancelViewTransitionName?: unknown;
    cancelRootViewTransitionName?: unknown;
    restoreRootViewTransitionName?: unknown;
    cloneRootViewTransitionContainer?: unknown;
    removeRootViewTransitionClone?: unknown;
    measureClonedInstance?: unknown;
    hasInstanceChanged?: unknown;
    hasInstanceAffectedParent?: unknown;
    startViewTransition?: unknown;
    startGestureTransition?: unknown;
    stopViewTransition?: unknown;
    getCurrentGestureOffset?: unknown;
    createViewTransitionInstance?: unknown;
    clearContainer?(container: HostArg): void;
    createFragmentInstance?: unknown;
    updateFragmentInstanceFiber?: unknown;
    commitNewChildToFragmentInstance?: unknown;
    deleteChildFromFragmentInstance?: unknown;
    cloneInstance?(instance: HostArg, type: HostType, oldProps: any, newProps: any, keepChildren: boolean, newChildSet: ChildSet | null): Instance;
    createContainerChildSet?(): ChildSet;
    appendChildToContainerChildSet?(childSet: ChildSet, child: HostArg): void;
    finalizeContainerChildren?(container: Container, newChildren: ChildSet): void;
    replaceContainerChildren?(container: Container, newChildren: ChildSet | null): void;
    cloneHiddenInstance?(instance: HostArg, type: HostType, props: any): Instance;
    cloneHiddenTextInstance?(instance: HostArg, text: string): TextInstance;
    isSuspenseInstancePending?(instance: SuspenseInstance): boolean;
    isSuspenseInstanceFallback?(instance: SuspenseInstance): boolean;
    getSuspenseInstanceFallbackErrorDetails?(instance: SuspenseInstance): { digest?: string | null };
    registerSuspenseInstanceRetry?(instance: SuspenseInstance, callback: () => void): void;
    canHydrateFormStateMarker?(instance: HydratableInstance, inRootOrSingleton: boolean): HydratableInstance | null;
    isFormStateMarkerMatching?(markerInstance: HydratableInstance): boolean;
    getNextHydratableSibling?(instance: HostArg): HydratableInstance | null;
    getNextHydratableSiblingAfterSingleton?(type: HostType, instance: HydratableInstance | null): HydratableInstance | null;
    getFirstHydratableChild?(parentInstance: Instance): HydratableInstance | null;
    getFirstHydratableChildWithinContainer?(parentContainer: Container): HydratableInstance | null;
    getFirstHydratableChildWithinActivityInstance?(parentInstance: ActivityInstance | null): HydratableInstance | null;
    getFirstHydratableChildWithinSuspenseInstance?(parentInstance: SuspenseInstance): HydratableInstance | null;
    getFirstHydratableChildWithinSingleton?(type: HostType, singleton: Instance, currentHydratableInstance: HydratableInstance | null): HydratableInstance | null;
    canHydrateInstance?(instance: HydratableInstance, type: HostType, props: any, inRootOrSingleton: boolean): Instance | null;
    canHydrateTextInstance?(instance: HydratableInstance, text: string, inRootOrSingleton: boolean): TextInstance | null;
    canHydrateActivityInstance?(instance: HydratableInstance, inRootOrSingleton: boolean): ActivityInstance | null;
    canHydrateSuspenseInstance?(instance: HydratableInstance, inRootOrSingleton: boolean): SuspenseInstance | null;
    hydrateInstance?(instance: HostArg, type: HostType, props: any, hostContext: HostContext, internalHandle: Fiber): boolean;
    hydrateTextInstance?(textInstance: HostArg, text: string, internalHandle: Fiber, parentInstanceProps: any): boolean;
    hydrateActivityInstance?(activityInstance: ActivityInstance, internalHandle: Fiber): void;
    hydrateSuspenseInstance?(suspenseInstance: SuspenseInstance, internalHandle: Fiber): void;
    getNextHydratableInstanceAfterActivityInstance?(activityInstance: ActivityInstance): HydratableInstance | null;
    getNextHydratableInstanceAfterSuspenseInstance?(suspenseInstance: SuspenseInstance): HydratableInstance | null;
    commitHydratedInstance?(instance: HostArg, type: HostType, props: any, internalHandle: Fiber): void;
    commitHydratedContainer?(container: Container): void;
    commitHydratedActivityInstance?(activityInstance: ActivityInstance | null): void;
    commitHydratedSuspenseInstance?(suspenseInstance: SuspenseInstance): void;
    finalizeHydratedChildren?(instance: HostArg, type: HostType, props: any, hostContext: HostContext): boolean;
    flushHydrationEvents?(): void;
    clearActivityBoundary?: unknown;
    clearSuspenseBoundary?(parentInstance: HostArg, suspenseInstance: HostArg): void;
    clearActivityBoundaryFromContainer?: unknown;
    clearSuspenseBoundaryFromContainer?(container: HostArg, suspenseInstance: HostArg): void;
    hideDehydratedBoundary?(suspenseInstance: HostArg): void;
    unhideDehydratedBoundary?(suspenseInstance: HostArg): void;
    shouldDeleteUnhydratedTailInstances?(parentType: HostType): boolean;
    diffHydratedPropsForDevWarnings?: unknown;
    diffHydratedTextForDevWarnings?: unknown;
    describeHydratableInstanceForDevWarnings?: unknown;
    validateHydratableInstance?(type: HostType, props: any, hostContext: HostContext): boolean;
    validateHydratableTextInstance?(text: string, hostContext: HostContext): boolean;
    supportsResources?: boolean;
    isHostHoistableType?(type: string, props: any, hostContext: HostContext): boolean;
    getHoistableRoot?(container: Container): HoistableRoot;
    getResource?(type: HostType, currentProps: any, pendingProps: any, currentResource: ResourceArg): Resource | null;
    acquireResource?(hoistableRoot: HoistableRoot | null, resource: ResourceArg, props: any): Instance | null;
    releaseResource?(resource: ResourceArg): void;
    hydrateHoistable?(hoistableRoot: HoistableRoot | null, type: HostType, props: any, internalHandle: Fiber): Instance;
    mountHoistable?(hoistableRoot: HoistableRoot | null, type: HostType, instance: HostArg): void;
    unmountHoistable?(instance: HostArg): void;
    createHoistableInstance?(type: HostType, props: any, rootContainer: Container | null, internalHandle: Fiber): Instance;
    prepareToCommitHoistables?(): void;
    mayResourceSuspendCommit?(resource: ResourceArg): boolean;
    preloadResource?(resource: ResourceArg): boolean;
    suspendResource?(state: SuspendedState, hoistableRoot: HoistableRoot | null, resource: ResourceArg, props: any): void;
    supportsSingletons?: boolean;
    resolveSingletonInstance?(type: HostType, props: any, rootContainer: Container | null, hostContext: HostContext, validateDOMNestingDev: boolean): Instance;
    acquireSingletonInstance?(type: HostType, props: any, instance: HostArg, internalHandle: Fiber): void;
    releaseSingletonInstance?(instance: HostArg): void;
    isHostSingletonType?(type: string): boolean;
    isSingletonScope?(type: HostType): boolean;
  }
  interface Reconciler {
    attemptContinuousHydration?(fiber: Fiber): void;
    attemptHydrationAtCurrentPriority?(fiber: Fiber): void;
    attemptSynchronousHydration?(fiber: Fiber): void;
    batchedUpdates?(fn: (a: any) => any, a: any): any;
    createComponentSelector?(component: ElementType): Selector;
    createContainer?(
      containerInfo: Container,
      tag: RootTag,
      hydrationCallbacks: unknown,
      isStrictMode: boolean,
      concurrentUpdatesByDefaultOverride: boolean | null,
      identifierPrefix: string,
      onUncaughtError: OnUncaughtError,
      onCaughtError: OnCaughtError,
      onRecoverableError: OnRecoverableError,
      onDefaultTransitionIndicator: OnDefaultTransitionIndicator
    ): FiberRoot;
    createHasPseudoClassSelector?(selectors: Selector[]): Selector;
    createHydrationContainer?(
      initialChildren: ReactNode,
      callback: UpdateCallback | null | undefined,
      containerInfo: Container,
      tag: RootTag,
      hydrationCallbacks: unknown,
      isStrictMode: boolean,
      concurrentUpdatesByDefaultOverride: boolean | null,
      identifierPrefix: string,
      onUncaughtError: OnUncaughtError,
      onCaughtError: OnCaughtError,
      onRecoverableError: OnRecoverableError,
      onDefaultTransitionIndicator: OnDefaultTransitionIndicator,
      transitionCallbacks: unknown,
      formState: ReactFormState | null
    ): FiberRoot;
    createPortal?(children: ReactNode, containerInfo: Container, implementation: unknown, key?: unknown): ReactPortal;
    createRoleSelector?(role: string): Selector;
    createTestNameSelector?(id: string): Selector;
    createTextSelector?(text: string): Selector;
    defaultOnCaughtError?(error: Thrown): void;
    defaultOnRecoverableError?(error: Thrown): void;
    defaultOnUncaughtError?(error: Thrown): void;
    deferredUpdates?(fn: () => any): any;
    discreteUpdates?(fn: (a: any, b: any, c: any, d: any) => any, a: any, b: any, c: any, d: any): any;
    findAllNodes?(hostRoot: Instance, selectors: Selector[]): StateNode[];
    findBoundingRects?(hostRoot: Instance, selectors: Selector[]): BoundingRect[];
    findHostInstance?(component: ClassInstance): PublicInstance | null;
    findHostInstanceWithNoPortals?(fiber: Fiber): PublicInstance | null;
    findHostInstanceWithWarning?(component: ClassInstance, methodName?: string): PublicInstance | null;
    flushPassiveEffects?(): boolean;
    flushSyncFromReconciler?(fn?: (() => any) | null): any;
    flushSyncWork?(): boolean;
    focusWithin?(hostRoot: Instance, selectors: Selector[]): boolean;
    getFindAllNodesFailureDescription?(hostRoot: Instance, selectors: Selector[]): string | null;
    getPublicRootInstance?(container: FiberRoot): StateNode;
    injectIntoDevTools?(): boolean;
    isAlreadyRendering?(): boolean;
    observeVisibleRects?(hostRoot: Instance, selectors: Selector[], callback: ObserveVisibleRectsCallback, options?: IntersectionObserverOptionsLike): Disconnectable;
    shouldError?(fiber?: Fiber): boolean | null;
    shouldSuspend?(fiber?: Fiber): boolean;
    startHostTransition?(formFiber: Fiber, pendingState: TransitionStatus, action: ((formData: any) => unknown) | null, formData: any): void;
    updateContainer?(element: ReactNode, container: FiberRoot, parentComponent?: ClassInstance | null, callback?: UpdateCallback | null): Lane;
    updateContainerSync?(element: ReactNode, container: FiberRoot, parentComponent?: ClassInstance | null, callback?: UpdateCallback | null): Lane;
  }
}
