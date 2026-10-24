declare var module: { exports: any };
declare function require(name: string): any;
// rr-shapes.d.ts: the shapes of react-reconciler 0.33.0 (React 19.2), production bundle. READ OFF THE BUNDLE'S OWN BIRTHS:
// the members of an interface stand in the order in which the birth STORES them (a chain a.x = a.y = null stores y first).
// "birth NNNN" = line of original.js. "given" = the object is made elsewhere (react, scheduler, the host, the user).

// ---------------------------------------------------------------------------------------------------------------------
// 0. Globals the bundle names and the checker's library (ES only) lacks. Delete this block when a real library is in.
// ---------------------------------------------------------------------------------------------------------------------
declare var console: { error(...data: any[]): void };
declare function setTimeout(handler: () => void, timeout?: number): RR.TimeoutHandle;
declare var reportError: (error: any) => void;
declare var window: RR.WindowLike;
declare var process: RR.ProcessLike;
declare var AbortController: RR.AbortControllerConstructor;
declare var __REACT_DEVTOOLS_GLOBAL_HOOK__: RR.DevToolsHook;



declare namespace RR {
  // -------------------------------------------------------------------------------------------------------------------
  // 1. Numbers
  type int32 = import("bun").int32; // a true int32 where the annotation itself is the name; to every other tool a number. NOT Milliseconds, NOT NoTimeout: a time is a fraction
  type Lane = int32;
  type Lanes = int32;
  type LaneMap<T> = T[]; // 31 entries, createLaneMap
  type Flags = int32; // Fiber.flags | subtreeFlags
  type WorkTag = int32; // Fiber.tag: 0 Function 1 Class 3 HostRoot 4 Portal 5 Host 6 Text 7 Fragment 8 Mode 9 Consumer 10 Provider 11 ForwardRef 12 Profiler 13 Suspense 14 Memo 15 SimpleMemo 16 Lazy 18 DehydratedFragment 19 SuspenseList 21 Scope 22 Offscreen 23 LegacyHidden 24 Cache 25 TracingMarker 26 Hoistable 27 Singleton 29 Throw 30 ViewTransition 31 Activity
  type TypeOfMode = int32; // Fiber.mode
  type HookFlags = int32; // Effect.tag: 1 HasEffect 2 Insertion 4 Layout 8 Passive
  type RootTag = int32;
  type UpdateTag = int32; // Update.tag: 0 UpdateState 1 ReplaceState 2 ForceUpdate 3 CaptureUpdate
  type EventPriority = number; // a Lane: 2 | 8 | 32 | 268435456; the host's functions give it and take it
  type SchedulerPriority = number; // the scheduler's own constants
  type ExecutionContext = int32; // 2 Render 4 Commit
  type RootExitStatus = int32; // 0..6
  type SuspendedReason = int32; // 0..9
  type PendingEffectsStatus = int32; // 0..5
  type SuspenseContext = int32; // suspenseStackCursor
  type OffscreenVisibility = int32; // OffscreenInstance._visibility: 1 Visible 2 PassiveEffectsConnected
  type Milliseconds = number;

  // -------------------------------------------------------------------------------------------------------------------
  // 2. What truly is anything. `any`. NEVER PUT ONE OF THESE IN A UNION: T | any IS any, silently: the variable is
  //    read by name for its whole life and narrowing by assignment is off.
  // -------------------------------------------------------------------------------------------------------------------
  type ReactNode = any; // children: element | portal | lazy | thenable | context | iterable | text | nothing | garbage
  type ContextValue = any;
  type HookState = any; // Hook.memoizedState | baseState, a hook update's action | eagerState
  type Payload = any; // Update.payload: a partial state, an updater function, { element }, { cache }
  type Thrown = any; // what a catch clause holds, CapturedValue.value

  // -------------------------------------------------------------------------------------------------------------------
  // 3. What the host and the user give and the reconciler only carries about: OPAQUE, NOT any, so that a union with
  //    them stays a union and narrowing by assignment holds (probed on the checker). None of our shapes is assignable
  //    to them; `any` is. The one member says: there is no such member. To give the whole idea up: `type HostObject = any`.
  // -------------------------------------------------------------------------------------------------------------------
  interface HostObject { readonly $$rrHost?: never }
  interface ClassState { readonly $$rrState?: never } // a class component's this.state, as it lies in Fiber.memoizedState
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
  type SuspendedState = HostObject; // startSuspendingCommit()
  type UpdatePayload = HostObject; // not used by 0.33: commitUpdate takes the props
  type HostContext = HostObject | number | string | null;
  type TransitionStatus = HostObject | null;
  type TimeoutHandle = HostObject | number;
  type NoTimeout = number; // -1
  interface LegacyContext { readonly $$rrContext?: never } // emptyContextObject: `{}`. Not `object`: every shape is assignable to that, and narrowing by assignment would keep it
  /** Props of an element, where they are known to be an object. Fiber.pendingProps | memoizedProps are `any`: a text fiber holds a string there, a fragment its children, tag 29 what was thrown. */
  interface Props { [name: string]: unknown }
  /** A class component's state in a variable or parameter: the union of the field it comes from and goes to. */
  type State = MemoizedState;

  // What a host function TAKES. Wider than what it means, so that fiber.stateNode | memoizedState | type go in WITHOUT A CAST.
  type HostArg = StateNode;
  type ResourceArg = MemoizedState;
  type HostType = ElementType;

  // -------------------------------------------------------------------------------------------------------------------
  // 4. Fiber. birth 9947 FiberNode
  // -------------------------------------------------------------------------------------------------------------------
  interface Fiber {
    tag: WorkTag;
    key: string | null;
    elementType: any; // whatever stood in the element; compared by identity, given to resolveLazy
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
  // function FiberNode(this: RR.Fiber, ..) and new FiberNode(..): in a compile build `new` of such a function has the type of its `this`. No cast: one through `unknown` loses the callee

  /** Fiber.memoizedState by tag: 0 11 14 15 and 5 (a form): Hook · 1: ClassState · 3: RootState · 13 31: SuspenseState · 19: SuspenseListRenderState · 22 23: OffscreenState · 24: CacheComponentState · 26: Resource */
  type MemoizedState = Hook | RootState | SuspenseState | SuspenseListRenderState | OffscreenState | CacheComponentState | ClassState | Resource | null;
  /** Fiber.updateQueue by tag: 1 3 24: UpdateQueue · 0 11 14 15 and 5: FunctionComponentUpdateQueue · 13 19 31: RetryQueue · 22: OffscreenQueue */
  type FiberUpdateQueue = UpdateQueue | FunctionComponentUpdateQueue | OffscreenQueue | RetryQueue | null;
  /** Fiber.stateNode by tag: 3: FiberRoot · 1: ClassInstance · 4: PortalState · 5 6 18 26 27: HostObject · 13 19 31: RetryCache · 22: OffscreenInstance · 12: ProfilerState (never born in production) */
  type StateNode = FiberRoot | ClassInstance | PortalState | OffscreenInstance | RetryCache | ProfilerState | HostObject | null;

  // -------------------------------------------------------------------------------------------------------------------
  // 5. FiberRoot. birth 10186 FiberRootNode
  // -------------------------------------------------------------------------------------------------------------------
  interface FiberRoot {
    tag: RootTag;
    containerInfo: Container;
    pendingChildren: ChildSet | null;
    current: Fiber | null; // null only between FiberRootNode and the next statements of createFiberRoot
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
  // function FiberRootNode(this: RR.FiberRoot, ..) and new FiberRootNode(..), as for FiberNode
  type OnUncaughtError = (error: Thrown, errorInfo: ErrorInfo) => void;
  type OnCaughtError = (error: Thrown, errorInfo: CaughtErrorInfo) => void;
  type OnRecoverableError = (error: Thrown, errorInfo: ErrorInfo) => void;
  type OnDefaultTransitionIndicator = () => void | (() => void);
  interface ErrorInfo { componentStack: string | null } // births 3802 3857 9751
  interface CaughtErrorInfo { componentStack: string | null; errorBoundary: StateNode } // birth 3812
  type ReactFormState = [state: any, keyPath: string, referenceId: string | null, boundArgumentCount: number]; // given
  type PingCache = WeakMap<Wakeable, Set<Lanes>>;
  interface PingCacheConstructor { new (): PingCache } // PossiblyWeakMap
  /** memoizedState of the root fiber. births 5470 10263; and Object.assign({}, prev, payload) in processUpdateQueue makes more */
  interface RootState { element: ReactNode; isDehydrated: boolean; cache: Cache }
  interface RootUpdatePayload { element: ReactNode } // births 3825 10301

  // -------------------------------------------------------------------------------------------------------------------
  // 6. Update queues of classes, roots and Cache components
  // -------------------------------------------------------------------------------------------------------------------
  /** births 2323 2364 2451 2500 */
  interface Update { lane: Lane; tag: UpdateTag; payload: Payload; callback: UpdateCallback | null; next: Update | null }
  type UpdateCallback = (this: any) => unknown;
  /** birth 2307 */
  interface SharedQueue { pending: Update | null; lanes: Lanes; hiddenCallbacks: UpdateCallback[] | null }
  /** births 2303 2314 2380 */
  interface UpdateQueue {
    baseState: MemoizedState;
    firstBaseUpdate: Update | null;
    lastBaseUpdate: Update | null;
    shared: SharedQueue;
    callbacks: UpdateCallback[] | null;
  }
  /** What concurrentQueues and hiddenUpdates carry: an Update or a HookUpdate. NO BIRTH: a view over both (`lane` is their first member, `next` their last). */
  interface ConcurrentUpdate { lane: Lane; next: ConcurrentUpdate | null }
  /** A SharedQueue or a HookQueue. NO BIRTH: a view over both (`pending` is the first member of both). */
  interface ConcurrentQueue { pending: ConcurrentUpdate | null }
  /** concurrentQueues: fiber, queue, update, lane, fiber, queue .. */
  type ConcurrentQueuesEntry = any;

  // -------------------------------------------------------------------------------------------------------------------
  // 7. Hooks
  // -------------------------------------------------------------------------------------------------------------------
  /** births 2748 2780 3563 3577 */
  interface Hook {
    memoizedState: HookState; // state · Effect · [value, deps] · RefObject · EventFunctionRef · id · a bound function
    baseState: HookState;
    baseQueue: HookUpdate | null;
    queue: any;
    next: Hook | null;
  }
  /** births 2897 2914 2936 3624 3645 3692 */
  interface HookUpdate {
    lane: Lane;
    revertLane: Lane;
    gesture: null;
    action: HookState;
    hasEagerState: boolean;
    eagerState: HookState;
    next: HookUpdate | null;
  }
  /** births 3087 3247 3567 3581 10759 10878 */
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
  /** birth 3339 pushSimpleEffect. A ring: next is null only inside pushSimpleEffect */
  interface Effect { tag: HookFlags; create: EffectCreate; deps: HookDeps | null; inst: EffectInstance; next: Effect | null }
  /** births 3018 3317 3361 10834 */
  interface EffectInstance { destroy: EffectDestroy | void }
  /** birth 2795 */
  interface FunctionComponentUpdateQueue {
    lastEffect: Effect | null;
    events: EventFunctionPayload[] | null;
    stores: StoreConsistencyCheck[] | null;
    memoCache: MemoCache | null;
  }
  interface MemoCache { data: any[][]; index: number } // births 2832 2839
  interface EventFunctionRef { impl: (...args: any[]) => any } // birth 10904
  interface EventFunctionPayload { ref: EventFunctionRef; nextImpl: (...args: any[]) => any } // birth 3404
  interface StoreConsistencyCheck { getSnapshot: () => any; value: any } // birth 3037
  interface StoreInstance { value: any; getSnapshot: () => any } // birth 10826: THE OTHER ORDER
  type ActionFn = (state: any, payload: any) => any;
  /** birth 3269 */
  interface ActionStateQueue { state: any; dispatch: Dispatch | null; action: ActionFn | null; pending: ActionStateQueueNode | null }
  /** birth 3114. Also a thenable: it is given to setState and to useThenable */
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
  interface RefObject { current: any } // birth 10776
  type RefCallback = (instance: any) => void | (() => void);
  type Ref = RefCallback | RefObject | null;
  type RefCleanup = (() => void) | void | null;
  type DispatchTuple = [state: any, dispatch: Dispatch | null];
  type StartTransition = (callback: () => unknown) => void;
  type TransitionTuple = [isPending: boolean, start: StartTransition];
  type ActionStateTuple = [state: any, dispatch: Dispatch | null, isPending: boolean];
  type Usable = Thenable<any> | ReactContext<any>;

  /**
   * The table of hooks. births 10677 10703 10913 10961. THE FOUR BIRTHS DIFFER: the order here is that of 10677 and 10703; 10913 and 10961
   * write useInsertionEffect BEFORE useLayoutEffect; and only 10703 has useEffectEvent in the literal: the other three get it by a store behind
   * the birth (10702 10960 11013): hence optional.
   */
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
  /** birth 11073 */
  interface AsyncDispatcher { getCacheForType<T>(resourceType: () => T): T; cacheSignal(): AbortSignalLike }
  /** birth 11014 */
  interface ClassComponentUpdater {
    enqueueSetState(inst: ClassInstance, payload: Payload, callback?: UpdateCallback | null): void;
    enqueueReplaceState(inst: ClassInstance, payload: Payload, callback?: UpdateCallback | null): void;
    enqueueForceUpdate(inst: ClassInstance, callback?: UpdateCallback | null): void;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 8. Context, cache, transitions
  // -------------------------------------------------------------------------------------------------------------------
  interface ContextDependency { context: ReactContext<any>; memoizedValue: ContextValue; next: ContextDependency | null } // birth 1087
  interface Dependencies { lanes: Lanes; firstContext: ContextDependency | null } // births 1091 10005 10041
  /**
   * The one birth in the bundle is CacheContext (10618), whose order this is. GIVEN ONES COME IN OTHER ORDERS: react's createContext writes
   * $$typeof _currentValue _currentValue2 _threadCount Provider Consumer; a host's HostTransitionContext as the host pleases.
   */
  interface ReactContext<T = any> {
    $$typeof: symbol;
    Consumer: ConsumerType | null;
    Provider: ReactContext<T> | null;
    _currentValue: T;
    _currentValue2: T;
    _threadCount: number;
    displayName?: string;
  }
  interface Cache { controller: AbortControllerLike; data: Map<() => unknown, unknown>; refCount: number } // birth 1097
  /** births 5790 5803. CacheContext starts as null, so what is read off it is Cache | null */
  interface CacheComponentState { parent: Cache | null; cache: Cache | null }
  interface CacheUpdatePayload { cache: Cache } // birth 3615
  interface SpawnedCachePool { parent: Cache | null; pool: Cache | null } // births 1392 4252 5007
  interface AbortSignalLike { aborted: boolean; addEventListener(type: string, listener: () => void): void } // birth 10603 (the fallback)
  interface AbortControllerLike { signal: AbortSignalLike; abort(): void } // the fallback at 10601 stores signal, then abort
  interface AbortControllerConstructor { new (): AbortControllerLike }
  /** births 3145 3515: BORN EMPTY. `types` is read off it (undefined) and stored to the previous one */
  interface Transition { types?: string[] | null | undefined }

  // -------------------------------------------------------------------------------------------------------------------
  // 9. Suspense, Activity, Offscreen, SuspenseList
  // -------------------------------------------------------------------------------------------------------------------
  interface TreeContext { id: number; overflow: string } // births 4318 4791
  /** births 4314 (Activity) 4787 (Suspense) 11058 (SUSPENDED_MARKER): ONE SHAPE FOR TAGS 13 AND 31 */
  interface SuspenseState {
    dehydrated: SuspenseInstance | ActivityInstance | null;
    treeContext: TreeContext | null;
    retryLane: Lane;
    hydrationErrors: CapturedValue[] | null;
  }
  type ActivityState = SuspenseState;
  interface OffscreenState { baseLanes: Lanes; cachePool: SpawnedCachePool | null } // births 4195 4258 4752 5010
  type HiddenContext = OffscreenState; // currentTreeHiddenStackCursor
  /** births 4168 4233 */
  interface OffscreenInstance {
    _visibility: OffscreenVisibility;
    _pendingMarkers: null;
    _retryCache: RetryCache | null;
    _transitions: null;
  }
  interface OffscreenQueue { transitions: null; markerInstances: null; retryQueue: RetryQueue | null } // birth 3913
  type RetryQueue = Set<Wakeable>;
  type RetryCache = WeakSet<Wakeable>;
  interface RetryCacheConstructor { new (): RetryCache } // PossiblyWeakSet
  type SuspenseListTailMode = string | undefined; // "collapsed" | "hidden" | "visible"
  /** birth 5084. lastEffect is NOT in the birth: 5322 stores null to it (a leftover of React's): the object grows by a member there */
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
  interface ProfilerState { effectDuration: number; passiveEffectDuration: number } // no birth in production; read at 8187

  // Props of the built-in kinds. OffscreenProps is born here (births 4272 4396 4815 4865 4974 5026 5043); the others are given.
  interface OffscreenProps { mode: unknown; children: ReactNode }
  interface SuspenseProps { children?: ReactNode; fallback?: ReactNode }
  interface ActivityProps { mode?: unknown; children?: ReactNode }
  interface SuspenseListProps { revealOrder?: unknown; tail?: SuspenseListTailMode; children?: ReactNode }
  interface ProviderProps { value?: ContextValue; children?: ReactNode }
  interface ConsumerProps { children: (value: ContextValue) => ReactNode }
  interface ProfilerProps { id?: string; onPostCommit?: unknown; children?: ReactNode }

  // -------------------------------------------------------------------------------------------------------------------
  // 10. Thenables
  // -------------------------------------------------------------------------------------------------------------------
  type ThenableStatus = "pending" | "fulfilled" | "rejected";
  /** given. What is only waited for */
  interface Wakeable { then(onFulfill: () => unknown, onReject: () => unknown): unknown }
  /**
   * given (a Promise, mostly), or one of the four born below. ONE TYPE FOR ALL STATES, because the bundle moves an object from state to state by
   * stores (trackUsedThenable: status, then value | reason): a type per state would be false of the object at the cast.
   */
  interface Thenable<T = any> {
    then(onFulfill: (value: T) => unknown, onReject: (error: Thrown) => unknown): unknown;
    status?: string;
    value?: T;
    reason?: Thrown;
  }
  type ThenableState = Thenable<any>[]; // thenableState, thenableState$1
  /** birth 1326 currentEntangledActionThenable */
  interface EntangledActionThenable { status: ThenableStatus; value: undefined; then(resolve: () => unknown): void }
  /** birth 1354 chainThenableValue */
  interface ChainedThenable<T = any> { status: ThenableStatus; value: T | null; reason: Thrown; then(resolve: (value?: T) => unknown): void }
  /** birth 3549 */
  interface RejectedThenable { then(): void; status: "rejected"; reason: Thrown }
  /** birth 10650 noopSuspenseyCommitThenable */
  interface NoopThenable { then(): void }

  // -------------------------------------------------------------------------------------------------------------------
  // 11. Small things
  // -------------------------------------------------------------------------------------------------------------------
  interface StackCursor<T> { current: T } // birth 202 createCursor
  interface CapturedValue { value: Thrown; source: Fiber | null; stack: string | null } // births 709 717 4904
  type ForkStackEntry = Fiber | number | null; // forkStack: count, provider ..
  type IdStackEntry = Fiber | number | string | null; // idStack: id, overflow, provider ..
  interface PortalState { containerInfo: Container; pendingChildren: ChildSet | null; implementation: unknown } // birth 10179
  type ComponentFrameSample = [sample: string | null, control: string | null];
  interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } } // birth 535

  // -------------------------------------------------------------------------------------------------------------------
  // 12. What react makes: given. Orders are those of react 19.2's own production bundle.
  // -------------------------------------------------------------------------------------------------------------------
  interface ReactElement { $$typeof: symbol; type: any; key: string | null; ref: any; props: any }
  /** birth 11260 exports.createPortal */
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
  /** Fiber.type. (A lazy that resolves to garbage is stored to .type at 5371 a few lines before React throws its own error 306.) */
  type ElementType = string | symbol | FunctionComponent | ClassComponent | ReactContext<any> | ConsumerType | ForwardRefType | MemoType | LazyComponent | null;
  /** An instance of the user's class. React.Component's constructor stores props context refs updater; the rest is the user's and the reconciler's */
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
  /** React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: react writes { H, A, T, S } */
  interface SharedInternals {
    H: Dispatcher | null;
    A: AsyncDispatcher | null;
    T: Transition | null;
    S: ((transition: Transition, returnValue: unknown) => void) | null;
  }
  /** var React: RR.ReactModule = require("react") */
  interface ReactModule { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: SharedInternals }

  // -------------------------------------------------------------------------------------------------------------------
  // 13. The scheduler: given. var Scheduler: RR.SchedulerModule = require("scheduler")
  // -------------------------------------------------------------------------------------------------------------------
  type SchedulerCallback = (didTimeout: boolean) => SchedulerCallback | null | undefined | void;
  /** FiberRoot.callbackNode. The scheduler writes { id, callback, priorityLevel, startTime, expirationTime, sortIndex }; here it is compared and cancelled only */
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
    log?: unknown; // not in the public scheduler
    unstable_setDisableYieldValue?(newValue: boolean): void; // not in the public scheduler
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 14. DevTools, test selectors, globals
  // -------------------------------------------------------------------------------------------------------------------
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
  /** birth 11478; rendererConfig is stored behind the birth (11486) */
  interface DevToolsInternals {
    bundleType: number;
    version: string | undefined;
    rendererPackageName: string | undefined;
    currentDispatcherRef: SharedInternals;
    reconcilerVersion: string;
    rendererConfig?: unknown;
  }
  type SelectorType = symbol | number; // COMPONENT_TYPE .. TEXT_TYPE start as 0..4 and become symbols
  /** births 11181 11211 11269 11272 11275. value: a component | Selector[] | string, by $$typeof (a variable: the checker cannot narrow by it) */
  interface Selector { $$typeof: SelectorType; value: any }
  interface BoundingRect { x: number; y: number; width: number; height: number } // given
  interface IntersectionObserverOptionsLike { root?: unknown; rootMargin?: string; threshold?: number | number[] }
  type ObserveVisibleRectsCallback = (intersections: Array<{ ratio: number; rect: BoundingRect }>) => void;
  interface Disconnectable { disconnect(): void } // birth 11516
  interface ErrorEventInitLike { bubbles: boolean; cancelable: boolean; message: string; error: Thrown } // birth 10550
  interface WindowLike { ErrorEvent: new (type: string, init: ErrorEventInitLike) => object; dispatchEvent(event: object): boolean }
  interface ProcessLike { emit(name: string, error: Thrown): unknown }

  // -------------------------------------------------------------------------------------------------------------------
  // 15. HostConfig: every member the bundle reads off $$$config, in the order in which it reads them. given.
  //     REQUIRED = what DefinitelyTyped requires of every host. All else is OPTIONAL, because a host that lacks a capability lacks its functions
  //     (no hydration, no resources, no singletons ..) and a required member would be a false statement about that host.
  //     So `var appendChild = $$$config.appendChild` is `((..) => void) | undefined` and EVERY CALL OF AN OPTIONAL ONE TAKES `!`:
  //     appendChild!(parent, node)  (error TS2722; `tools.py bang NN` puts these too).
  //     NEVER `$$$config.appendChild!` at the declaration: that test would run, and fail, when the module starts.
  //     `?: unknown` = read and dropped by the bundle (`$$$config.cloneMutableInstance;`).
  // -------------------------------------------------------------------------------------------------------------------
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
    // microtasks
    supportsMicrotasks?: boolean;
    scheduleMicrotask?(fn: () => unknown): void;
    // test selectors
    supportsTestSelectors?: boolean;
    /** React's own type says FiberRoot; what the bundle does with it (8640: .stateNode.current) says: the root FIBER */
    findFiberRoot?(node: HostArg): Fiber | null;
    getBoundingRect?(node: HostArg): BoundingRect;
    getTextContent?(fiber: Fiber): string | null;
    isHiddenSubtree?(fiber: Fiber): boolean;
    matchAccessibilityRole?(node: HostArg, role: string): boolean;
    setFocusIfFocusable?(node: HostArg): boolean;
    setupIntersectionObserver?(targets: HostArg[], callback: ObserveVisibleRectsCallback, options?: IntersectionObserverOptionsLike): Disconnectable;
    // mutation
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
    // persistence
    cloneInstance?(instance: HostArg, type: HostType, oldProps: any, newProps: any, keepChildren: boolean, newChildSet: ChildSet | null): Instance;
    createContainerChildSet?(): ChildSet;
    appendChildToContainerChildSet?(childSet: ChildSet, child: HostArg): void;
    finalizeContainerChildren?(container: Container, newChildren: ChildSet): void;
    replaceContainerChildren?(container: Container, newChildren: ChildSet | null): void;
    cloneHiddenInstance?(instance: HostArg, type: HostType, props: any): Instance;
    cloneHiddenTextInstance?(instance: HostArg, text: string): TextInstance;
    // hydration
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
    // resources
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
    // singletons
    supportsSingletons?: boolean;
    resolveSingletonInstance?(type: HostType, props: any, rootContainer: Container | null, hostContext: HostContext, validateDOMNestingDev: boolean): Instance;
    acquireSingletonInstance?(type: HostType, props: any, instance: HostArg, internalHandle: Fiber): void;
    releaseSingletonInstance?(instance: HostArg): void;
    isHostSingletonType?(type: string): boolean;
    isSingletonScope?(type: HostType): boolean;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 16. What module.exports' function returns. birth 10320: `var exports: RR.Reconciler = {}`: BORN EMPTY and filled by 36 stores, in this order:
  //     hence every member optional.
  // -------------------------------------------------------------------------------------------------------------------
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

// =====================================================================================================================
// THE MODULE'S VARIABLES (pieces 19 and 20 declare them; every piece reads them). One type each, so that all pieces agree.
// =====================================================================================================================
// React: RR.ReactModule · Scheduler: RR.SchedulerModule · ReactSharedInternals: RR.SharedInternals (inferred) · exports: RR.Reconciler
// valueStack: any[] · index$jscomp$0: number · emptyContextObject: RR.LegacyContext
// rendererID: number | null · injectedHook: RR.DevToolsHook | null · prefix, suffix: string | undefined
// CapturedStacks: WeakMap<object, RR.CapturedValue>
// forkStack: RR.ForkStackEntry[] · treeForkProvider: RR.Fiber | null · treeForkCount: number
// idStack: RR.IdStackEntry[] · treeContextProvider: RR.Fiber | null · treeContextId: number · treeContextOverflow: string
// contextStackCursor: RR.StackCursor<RR.HostContext> · contextFiberStackCursor: RR.StackCursor<RR.Fiber | null>
// rootInstanceStackCursor: RR.StackCursor<RR.Container | null> · hostTransitionProviderCursor: RR.StackCursor<RR.Fiber | null>
// hydrationParentFiber: RR.Fiber | null · nextHydratableInstance: RR.HydratableInstance | null · hydrationErrors: RR.CapturedValue[] | null
// valueCursor: RR.StackCursor<RR.ContextValue> · currentlyRenderingFiber$1: RR.Fiber | null · lastContextDependency: RR.ContextDependency | null
// AbortControllerLocal: RR.AbortControllerConstructor · CacheContext: RR.ReactContext<RR.Cache | null>
// firstScheduledRoot, lastScheduledRoot: RR.FiberRoot | null · currentEventTransitionLane, currentEntangledLane: RR.Lane
// currentEntangledListeners: Array<() => unknown> | null · currentEntangledActionThenable: RR.EntangledActionThenable | null
// prevOnStartTransitionFinish: RR.SharedInternals["S"] (inferred) · resumedCache: RR.StackCursor<RR.Cache | null>
// noopSuspenseyCommitThenable: RR.NoopThenable · suspendedThenable: RR.Thenable | RR.NoopThenable | null
// thenableState$1, thenableState: RR.ThenableState | null · concurrentQueues: RR.ConcurrentQueuesEntry[]
// currentTreeHiddenStackCursor: RR.StackCursor<RR.HiddenContext | null> · prevEntangledRenderLanesCursor: RR.StackCursor<RR.Lanes>
// suspenseHandlerStackCursor: RR.StackCursor<RR.Fiber | null> · shellBoundary: RR.Fiber | null · suspenseStackCursor: RR.StackCursor<RR.SuspenseContext>
// renderLanes: RR.Lanes · currentlyRenderingFiber: RR.Fiber | null · currentHook, workInProgressHook: RR.Hook | null
// ContextOnlyDispatcher, HooksDispatcherOnMount, HooksDispatcherOnUpdate, HooksDispatcherOnRerender: RR.Dispatcher
// classComponentUpdater: RR.ClassComponentUpdater · SUSPENDED_MARKER: RR.SuspenseState · DefaultAsyncDispatcher: RR.AsyncDispatcher
// PossiblyWeakSet: RR.RetryCacheConstructor · PossiblyWeakMap: RR.PingCacheConstructor
// nextEffect: RR.Fiber | null · hostParent: RR.StateNode (an Instance | Container | null) · currentHoistableRoot: RR.HoistableRoot | null · suspenseyCommitFlag: RR.Flags
// COMPONENT_TYPE .. TEXT_TYPE: RR.SelectorType
// executionContext: RR.ExecutionContext · workInProgressRoot: RR.FiberRoot | null · workInProgress: RR.Fiber | null
// workInProgressRootRenderLanes and the other ..Lanes | ..Lane: RR.Lanes | RR.Lane · workInProgressSuspendedReason: RR.SuspendedReason
// workInProgressThrownValue: RR.Thrown · workInProgressRootExitStatus: RR.RootExitStatus
// workInProgressRootConcurrentErrors, workInProgressRootRecoverableErrors, pendingRecoverableErrors: RR.CapturedValue[] | null
// workInProgressTransitions, pendingPassiveTransitions: RR.Transition[] | null
// legacyErrorBoundariesThatAlreadyFailed: Set<RR.ClassInstance> | null · pendingEffectsStatus: RR.PendingEffectsStatus
// pendingEffectsRoot, rootWithNestedUpdates: RR.FiberRoot | null · pendingFinishedWork: RR.Fiber | null
