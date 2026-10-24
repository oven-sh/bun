// rr-shapes-11.d.ts: piece 11's additions (original.js 5832..6593: markUpdate .. bubbleProperties, completeWork).
declare namespace RR {
  /**
   * Fiber.pendingProps | memoizedProps WHERE THEY MUST STAND IN A UNION: completeWork's `newProps` (6118) starts as workInProgress.pendingProps FOR EVERY TAG and holds a
   * Cache, a SuspenseState, a Fiber, a SuspenseListRenderState afterwards. `any` | `unknown` would swallow the union (narrowing by assignment off, every later read by name).
   * IT MUST BE TRUE OF EVERY VALUE, NOT ONLY OF AN ELEMENT'S PROPS AND A TEXT: a fragment's pendingProps are its children. PROBED ON THE COMPILER:
   * `var p: Props | string | Fiber | null = f.pendingProps` THROWS for <>{5}</>: "TypeError: expected object | string, got number 5" (also true, a symbol).
   * THE OBJECT MEMBER IS Props (an index signature), NOT A WEAK OPAQUE INTERFACE { $$rr..?: never }: PROBED: Props is `object function` in the IR, so this union is
   * type #0 (everything) and the `any` enters WITHOUT A TEST; with a weak opaque interface the union is a list of classes and every `any` that enters is a `Cast As`:
   * 45 to 100 ns a time for an object (100 M entries: 4.5 to 10 s against 0.3 to 1.9 s; `any`: 0.2 to 1.5 s). Reads behind a store of a shape stay typed (faster than `any`).
   * No interface of ours is assignable to Props (an interface has no implicit index signature), so narrowing by assignment holds.
   * The same idea as ThrownInUnion (2), HookStateInUnion (5), Carried (8), Given (9), Anything (10): ONE NAME WOULD DO FOR THE SIX.
   */
  type PropsInUnion = Props | string | number | bigint | boolean | symbol | null | undefined;

  /**
   * Props as a function OF OURS takes them that only compares them by identity and hands them on to the host (whose parameters are `any`): updateHostComponent,
   * preloadInstanceAndSuspendIfNeeded. Like HostArg: wider than what it means, so that completeWork's reused variables go in WITHOUT A CAST. Nothing can be read off it.
   */
  type PropsArg = unknown;

  // completeWork (6117) reuses its two parameters and three of its locals for all that follows. One name a variable; "case N" = the tag under which the member is stored.
  /** `current`. given: Fiber | null · case 27: HostContext, Instance · 6: Container | null, TextInstance · 31: SuspenseState | null, ActivityInstance | null, boolean · 13: boolean · 19: Fiber | null, FiberUpdateQueue, Lanes */
  type CompleteWorkCurrent = Fiber | HostContext | Instance | SuspenseState | FiberUpdateQueue | Lanes | boolean | null;
  /** `renderLanes`. given: Lanes · case 3: FiberRoot · 27: Container | null · 6: a text (string), HostContext · 31: MemoizedState (only tested for null), CapturedValue[] | null · 13: boolean · 19: Fiber | null, SuspenseContext · 22 23: OffscreenQueue | null, Cache | null · 24: Cache | null */
  type CompleteWorkRenderLanes = Lanes | FiberRoot | HostContext | MemoizedState | CapturedValue[] | Fiber | OffscreenQueue | Cache | boolean | null;
  /** `newProps`. Starts as pendingProps · case 3: Cache | null · 6: the parent's props · 31: boolean · 13: SuspenseState | null, Fiber | null · 19: SuspenseListRenderState | null · 22 23: boolean, Cache | null */
  type CompleteWorkNewProps = PropsInUnion | Cache | SuspenseState | SuspenseListRenderState | Fiber;
  /** `type`. case 26 27 5: Fiber.type · 6: Fiber | null (hydrationParentFiber) · 13: boolean, SuspenseState | null, SuspenseInstance | null, CapturedValue[] | null, Cache | null · 19: boolean */
  type CompleteWorkType = ElementType | Fiber | SuspenseState | SuspenseInstance | CapturedValue[] | Cache | boolean | null;
  /** `nextResource`. case 26: MemoizedState (a Resource | null), the old props · 5: HostContext · 13: Cache | null · 19: Fiber | null */
  type CompleteWorkNextResource = MemoizedState | Props | HostContext | Cache | Fiber | null;
}
