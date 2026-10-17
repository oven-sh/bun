// fz-shapes.d.ts: the shapes of react-dom 19.2.8, cjs/react-dom-server.bun.production.js (Fizz). CARRIED OVER FROM 19.3.0's AND MENDED. READ OFF THIS BUNDLE'S OWN BIRTHS:
// the members of an interface stand in the order in which the birth STORES them (a chain this.a = this.b = 0 stores b first).
// "birth NNNN" = line of original.js. "given" = the value is made elsewhere (react, react-dom, Bun, Node, the user).
// CHECKED BY PROGRAM (python3 shapes_check.py): the births named behind the heads have their interface's members, in its order; no two births of one interface differ; every FZ name the pieces use is declared.
// THE CHECKER DOES NOT LOOK INTO A .d.ts (it says "0 files"; a name that does not exist there is silently any): shapes_check.py checks all fz-shapes*.d.ts as .ts, and the births again. births.txt (python3 births.py): every birth of this bundle.
// WHAT 19.3.0 HAS AND THIS VERSION HAS NOT: prerender | resume | the Node streams (one export: renderToReadableStream), so no PostponedState, no StaticResult, no FakeWritable, no PipeableStream, no birth of PostponedHoles;
//   Ping (Task.ping is a function), BoundaryPreamble and TrackedBoundary (SuspenseBoundary has the four members flat), SuspenseBoundary.defer, ViewTransitionContext.parentEnter | parentExit,
//   Request.aborted | currentTask | postponedState | onBrowserBailout | renderLifetimeController (aborting is status 12 here; Request.onPostpone is here instead).
declare namespace FZ {
  // -------------------------------------------------------------------------------------------------------------------
  // 1. Numbers. int32: four bytes and integer arithmetic; the build proves every value that is stored there, or stops.
  // -------------------------------------------------------------------------------------------------------------------
  type int32 = import("bun").int32;
  type RequestStatus = int32; // Request.status: 10 OPENING 11 OPEN 12 ABORTING 13 CLOSING 14 CLOSED
  type SegmentStatus = int32; // Segment.status: 0 PENDING 1 COMPLETED 2 FLUSHED 3 ABORTED 4 ERRORED 5 POSTPONED 6 RENDERING
  type BoundaryStatus = int32; // SuspenseBoundary.status: 0 PENDING 1 COMPLETED 4 CLIENT_RENDERED 5 POSTPONED
  type StylesheetState = int32; // StylesheetResource.state: 0 PENDING 1 PRELOADED 2 PREAMBLE 3 LATE
  type InsertionMode = int32; // 0 ROOT_HTML 1 HTML_HTML 2 HTML 3 HTML_HEAD 4 SVG 5 MATHML 6 TABLE 7 TABLE_BODY 8 TABLE_ROW 9 COLGROUP
  type TagScope = int32; // bits: 1 NOSCRIPT 2 PICTURE 4 FALLBACK 8 EXIT 16 ENTER 32 UPDATE 64 APPEARING
  type InstructionState = int32; // bits: 1 $RS 2 $RC 4 $RX 8 $RR 16 form replay 32 shell id 64 shell time 128 needs view transitions (stored at 551, never tested)
  type SegmentId = int32; // Segment.id, SuspenseBoundary.rootSegmentID, Request.nextSegmentId: -1 = none yet
  type ChildIndex = int32; // Task.childIndex: -1 = not a child of an array
  type TaskCount = int32; // every pendingTasks | allPendingTasks | pendingRootTasks
  type ChunkIndex = int32; // Segment.index, a length of chunks | children
  type TreeId = int32; // TreeContext.id: made by << | & alone
  type ContextDepth = int32;
  type HookCounter = int32; // localIdCounter actionStateCounter actionStateMatchingIndex (-1) thenableIndexCounter numberOfReRenders
  type ByteSize = number; // sums of Buffer.byteLength: NOT int32
  type HeaderCapacity = number; // 2 + options.maxHeadersLength: NOT int32: the user's number

  // -------------------------------------------------------------------------------------------------------------------
  // GIVEN (section 2): what other code makes: `any` under a name. NEVER PUT ONE OF THESE IN A UNION: T | any IS any, silently.
  //    Where such a member or variable may hold null the comment says so; the type does not.
  // -------------------------------------------------------------------------------------------------------------------
  type ReactNode = any; // children, Task.node: element | lazy | thenable | context | iterable | text | nothing | garbage
  type ReactElement = any; // react's jsx() makes it: $$typeof type key props
  type Props = any; // an element's props
  type PropValue = any; // one value out of props or out of an options bag
  type ElementType = any; // element.type: string | function | class | symbol | { $$typeof .. }; ComponentStackNode.type
  type ComponentName = any; // getComponentNameFromType: type.displayName || type.name || null: a string | null by React's types, never tested
  type KeyOrIndex = any; // element.key (react makes it a string) or the child's index: carried, compared by ===, given to JSON
  type FunctionComponent = any; // also forwardRef's render
  type ClassComponent = any;
  type ClassInstance = any; // new type(props, context): updater props state context _reactInternals are stored on it by name
  type ClassState = any;
  type Ref = any;
  type ReactContext = any; // react's createContext makes it: _currentValue is read and stored by name
  type ContextValue = any;
  type LazyComponent = any; // _payload _init
  type Thenable = any; // the user's promise: status | value | reason are stored on it (trackUsedThenable)
  type Thrown = any; // what a catch clause holds, Request.fatalError, abort's reason
  type HookState = any; // Hook.memoizedState: state · [value, deps] · RefObject; Update.action
  type HookDeps = any; // the user's array of dependencies: never tested to be one. null | undefined when none
  type IteratorFn = any; // getIteratorFn's result (null when none), and the iterator and steps it gives
  type Destination = any; // Bun's direct stream controller: read by name. null when none
  type StreamController = any;
  type WebReadableStream = any;
  type AbortSignalGiven = any;
  type Options = any; // the bag the exported function is handed; the bag of preload | preloadModule | preinit*
  type ReactFormState = any; // options.formState: [state, keyPath, referenceId, boundArgumentCount]. null when none
  type FormAction = any; // a server action: $$FORM_ACTION $$IS_SIGNATURE_EQUAL bind
  type CustomFormFields = any; // what $$FORM_ACTION gives: name action encType method target data. null when none
  type FormDataGiven = any; // null when none
  type Nonce = any; // options.nonce | .script | .style: a string or undefined by React's types; null and 0 get through
  type SelectedValue = any; // <select>'s value | defaultValue. null when none
  type ViewTransitionValue = any; // off the parent's context, or "none": NO <ViewTransition> IS RENDERED BY THIS BUNDLE: FormatContext.viewTransition is null throughout, the one birth (540) is never reached
  type BootstrapScriptContent = any; // options.bootstrapScriptContent: string | undefined
  type BootstrapScripts = any; // options.bootstrapScripts | bootstrapModules: Array<string | { src, integrity, crossOrigin }> | undefined
  type ImportMap = any;
  type ReactModule = any; // require("react"): Children version __CLIENT_INTERNALS..
  type ReactDOMModule = any; // require("react-dom")
  type SharedInternals = any; // react's { H, A, T, S .. }: H and A are stored by name (performWork)
  type DOMSharedInternals = any; // react-dom's { d, p, findDOMNode }: d is stored by name (218)
  type HostDispatcherGiven = any; // previousDispatcher: react-dom's own { f r D C L m X S M }
  type GivenFunction = any;

  // -------------------------------------------------------------------------------------------------------------------
  // 3. Chunks, dictionaries, tuples
  // -------------------------------------------------------------------------------------------------------------------
  type Chunk = string; // the Bun bundle has no stringToChunk: a chunk IS the string; writeChunk tests .length, Buffer.byteLength measures it
  type PrecomputedChunk = string; // no stringToPrecomputedChunk either
  type Resource = Chunk[]; // a <link> | <script> as chunks; emptied by .length = 0 when flushed or adopted

  // DICTIONARIES: born {} (or by Object.assign, or by JSON.parse) and read by a computed name: plain objects, no layout.
  type PropsBag = { [name: string]: any }; // props MADE here: {} 4247 4749 · 326 381 (members are ADDED behind the birth) · every first argument and result of assign()
  type Assign = (target: PropsBag, ...sources: any[]) => PropsBag; // var assign: so that its literal first arguments are checked as dictionaries
  type NameCache = { [name: string]: boolean }; // births 60 61
  type PreloadState = PropValue[]; // [] (PRELOAD_NO_CREDS, one array, compared by .length) | [crossOrigin, integrity] births 2636 2654 2713 5657
  type ResourceDict = { [key: string]: PreloadState | null }; // null = Exists. births 296 299 300 453..455 457 2664 2721
  type ExistsDict = { [key: string]: null }; // births 297 298 451 452
  type UnknownResourceDict = { [as: string]: ResourceDict }; // births 450 456
  type ConnectBucket = "default" | "anonymous" | "credentials";
  type ConnectResources = { [bucket: string]: ExistsDict }; // births 298 452: { default, anonymous, credentials }: only ever read as [bucket]
  type SlotMap = { [index: string]: SegmentId | undefined }; // births 5283 5295 5300; stored: segment.id alone (5305); READ FOR EVERY CHILD INDEX, also those without a slot, and told apart by "number" === typeof (4099 5194): undefined = absent; members are deleted as they are resumed (4102 5197 5532)
  type ThrownInfo = { [name: string]: unknown }; // births 3980 5666 5998 6631 6708: {}; componentStack is an ACCESSOR put by Object.defineProperty. Only handed to onError

  // TUPLES: arrays the bundle builds; JSON.stringify sees the first (useActionState 3297).
  type KeyNode = [parent: KeyNode | null, name: ComponentName, keyOrIndex: KeyOrIndex]; // births 4594 4727 4875 5042 5136
  /**
   * births 4595 5277 5296 6640 (4 long) 5223 (6 long). ONE TYPE: the bundle makes a 4 into a 6 by stores (5235 5236) and a 6 into a 4 by .length = 4 (5316).
   * 4 === node.length tells them apart but does not narrow: node[4]! node[5]! in the other branch.
   */
  type ReplayNode = [name: ComponentName, keyOrIndex: KeyOrIndex, children: ReplayNode[], slots: ResumeSlots, fallback?: ReplayNode | null, rootSegmentID?: SegmentId];
  type ResumeSlots = SlotMap | SegmentId | null; // null nothing · a number: resume at the root position · a map: child index -> segment id
  type ThenableState = Thenable[]; // birth 3343
  type MemoState = [value: any, deps: HookDeps]; // birth 3247, in Hook.memoizedState
  type DispatchTuple = [state: HookState, dispatch: Dispatch | null]; // births 3205 3207 3224
  type OptimisticTuple = [state: HookState, dispatch: Dispatch]; // birth 3425
  type TransitionTuple = [isPending: boolean, start: (callback?: GivenFunction) => void]; // birth 3394
  type ActionStateTuple = [state: HookState, dispatch: ActionDispatch, isPending: boolean]; // births 3329 3332
  type ComponentFrameSample = [sample: string | null, control: string | null]; // births 3518 3520

  // -------------------------------------------------------------------------------------------------------------------
  // 4. Request
  // -------------------------------------------------------------------------------------------------------------------
  interface Request { // birth 3706 RequestInstance
    destination: Destination; // null when none
    flushScheduled: boolean;
    resumableState: ResumableState;
    renderState: RenderState;
    rootFormatContext: FormatContext;
    progressiveChunkSize: number; // 12800 | options.progressiveChunkSize (given: React's type says number)
    status: RequestStatus;
    fatalError: Thrown; // null until fatalError() | abort()
    nextSegmentId: number;
    allPendingTasks: number;
    pendingRootTasks: number;
    completedRootSegment: Segment | null;
    completedPreambleSegments: Segment[][] | null;
    byteSize: ByteSize;
    abortableTasks: Set<Task>;
    pingedTasks: Task[];
    clientRenderedBoundaries: SuspenseBoundary[];
    completedBoundaries: SuspenseBoundary[];
    partialBoundaries: SuspenseBoundary[];
    trackedPostpones: PostponedHoles | null; // null at the birth and never stored again IN THIS BUNDLE (no prerender here)
    onError: ErrorHandler;
    onPostpone: PostponeHandler; // never read
    onAllReady: () => void;
    onShellReady: () => void;
    onShellError: (error: Thrown) => void;
    onFatalError: (error: Thrown) => void;
    formState: ReactFormState; // null when none
  }
  /** function RequestInstance(this: FZ.Request, ..) and new (RequestInstance as FZ.RequestConstructor)(..): with the call signature beside the construct signature the cast needs no `unknown`, through which the function would leave typed code */
  interface RequestConstructor {
    new (
      resumableState: ResumableState,
      renderState: RenderState,
      rootFormatContext: FormatContext,
      progressiveChunkSize: number | undefined,
      onError: ErrorHandler | undefined,
      onAllReady: (() => void) | undefined,
      onShellReady: (() => void) | undefined,
      onShellError: ((error: Thrown) => void) | undefined,
      onFatalError: ((error: Thrown) => void) | undefined,
      onPostpone: PostponeHandler | undefined,
      formState: ReactFormState
    ): Request;
    (this: Request,
      resumableState: ResumableState,
      renderState: RenderState,
      rootFormatContext: FormatContext,
      progressiveChunkSize: number | undefined,
      onError: ErrorHandler | undefined,
      onAllReady: (() => void) | undefined,
      onShellReady: (() => void) | undefined,
      onShellError: ((error: Thrown) => void) | undefined,
      onFatalError: ((error: Thrown) => void) | undefined,
      onPostpone: PostponeHandler | undefined,
      formState: ReactFormState
    ): void;
  }
  type ErrorHandler = (error: Thrown, errorInfo: ThrownInfo) => any; // the user's, or defaultErrorHandler. The result: a digest; what is no string | null | undefined is dropped
  type ErrorDigest = string | null | undefined; // logRecoverableError's result
  type PostponeHandler = (reason: string, postponeInfo: ThrownInfo) => void; // options.onPostpone (the user's), or noop: stored by RequestInstance (3739), never read in this bundle

  // -------------------------------------------------------------------------------------------------------------------
  // 5. Task, Segment, SuspenseBoundary, SuspenseListRow
  // -------------------------------------------------------------------------------------------------------------------
  /** React's RenderTask (3874: replay null, blockedSegment a Segment) and ReplayTask (3919: replay a ReplaySet, blockedSegment null): THE SAME MEMBERS IN THE SAME ORDER, and resumeNode (4836) turns one into the other and back: ONE SHAPE */
  interface Task { // birth 3874 3919
    replay: ReplaySet | null;
    node: ReactNode;
    childIndex: ChildIndex;
    ping: () => void; // handed to thenable.then(ping, ping)
    blockedBoundary: SuspenseBoundary | null; // null = the root
    blockedSegment: Segment | null;
    blockedPreamble: PreambleState | null;
    hoistableState: HoistableState | null;
    abortSet: Set<Task>;
    keyPath: KeyNode | null; // null = the root
    formatContext: FormatContext;
    context: ContextNode | null;
    treeContext: TreeContext;
    row: SuspenseListRow | null;
    componentStack: ComponentStackNode | null;
    thenableState: ThenableState | null;
  }
  interface Segment { // birth 3950
    status: SegmentStatus;
    parentFlushed: boolean;
    id: number;
    index: ChunkIndex; // where in the parent's chunks it goes
    chunks: Chunk[];
    children: Segment[];
    preambleChildren: Segment[];
    parentFormatContext: FormatContext;
    boundary: SuspenseBoundary | null;
    lastPushedText: boolean;
    textEmbedded: boolean;
  }
  interface SuspenseBoundary { // birth 3823
    status: BoundaryStatus;
    rootSegmentID: number;
    parentFlushed: boolean;
    pendingTasks: number;
    row: SuspenseListRow | null;
    completedSegments: Segment[];
    byteSize: ByteSize;
    fallbackAbortableTasks: Set<Task>;
    errorDigest: ErrorDigest;
    contentState: HoistableState;
    fallbackState: HoistableState;
    contentPreamble: PreambleState | null;
    fallbackPreamble: PreambleState | null;
    trackedContentKeyPath: KeyNode | null;
    trackedFallbackNode: ReplayNode | null;
  }
  interface SuspenseListRow { // birth 4063
    pendingTasks: number;
    boundaries: SuspenseBoundary[] | null;
    hoistables: HoistableState;
    inheritedHoistables: HoistableState | null;
    together: boolean;
    next: SuspenseListRow | null;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 6. Postponing and replaying. DEAD IN THIS BUNDLE, AND STILL ITS TEXT: nothing stores Request.trackedPostpones (null at the birth: 3737), no task is born
  //    with a replay but from a task that has one (createReplayTask's callers: 5029 5319): the code that reads them is typed all the same.
  // -------------------------------------------------------------------------------------------------------------------
  interface PostponedHoles { workingMap: Map<KeyNode, ReplayNode>; rootNodes: ReplayNode[]; rootSlots: ResumeSlots } // NO BIRTH in this bundle (19.3.0's createPrerenderRequest makes it)
  interface ReplaySet { nodes: ReplayNode[]; slots: ResumeSlots; pendingTasks: number } // birth 4895 4990 5032 5148

  // -------------------------------------------------------------------------------------------------------------------
  // 7. The DOM side: RenderState, ResumableState, FormatContext, resources
  // -------------------------------------------------------------------------------------------------------------------
  interface RenderState { // birth 283
    placeholderPrefix: PrecomputedChunk;
    segmentPrefix: PrecomputedChunk;
    boundaryPrefix: PrecomputedChunk;
    startInlineScript: PrecomputedChunk;
    startInlineStyle: PrecomputedChunk;
    preamble: PreambleState;
    externalRuntimeScript: null; // never stored again, never read
    bootstrapChunks: Chunk[];
    importMapChunks: Chunk[];
    onHeaders: OnHeaders | undefined; // onHeadersImpl (6667) or undefined: never stored again
    headers: PreloadHeaders | null;
    resets: ResourceResets;
    charsetChunks: Chunk[];
    viewportChunks: Chunk[];
    hoistableChunks: Chunk[];
    preconnects: Set<Resource>;
    fontPreloads: Set<Resource>;
    highImagePreloads: Set<Resource>;
    styles: Map<string, StyleQueue>; // by precedence
    bootstrapScripts: Set<Resource>;
    scripts: Set<Resource>;
    bulkPreloads: Set<Resource>;
    preloads: PreloadMaps;
    nonce: NoncePair;
    hoistableState: HoistableState | null; // never stored again, never read
    stylesToHoist: boolean;
  }
  type OnHeaders = (headers: PropsBag) => void; // is handed { Link } (5662) or {}
  interface PreloadHeaders { preconnects: string; fontPreloads: string; highImagePreloads: string; remainingCapacity: HeaderCapacity } // birth 275
  interface ResourceResets { font: ResourceDict; dns: ExistsDict; connect: ConnectResources; image: ResourceDict; style: ResourceDict } // birth 295
  interface PreloadMaps { // birth 312
    images: Map<string, Resource>;
    stylesheets: Map<string, Resource>;
    scripts: Map<string, Resource>;
    moduleScripts: Map<string, Resource>;
  }
  interface NoncePair { script: Nonce; style: Nonce } // birth 318
  interface ResumableState { // birth 440
    idPrefix: string; // "" | options.identifierPrefix (given: React's type says string)
    nextFormID: number;
    streamingFormat: int32; // 0, never read
    bootstrapScriptContent: BootstrapScriptContent; // NOT OPTIONAL HERE (19.3.0: optional, for what JSON made of a postponed state): one birth, all 17 members, no resume
    bootstrapScripts: BootstrapScripts;
    bootstrapModules: BootstrapScripts;
    instructions: InstructionState;
    hasBody: boolean;
    hasHtml: boolean;
    unknownResources: UnknownResourceDict;
    dnsResources: ExistsDict;
    connectResources: ConnectResources;
    imageResources: ResourceDict;
    styleResources: ResourceDict;
    scriptResources: ResourceDict;
    moduleUnknownResources: UnknownResourceDict;
    moduleScriptResources: ResourceDict;
  }
  interface PreambleState { htmlChunks: Chunk[] | null; headChunks: Chunk[] | null; bodyChunks: Chunk[] | null } // birth 461
  interface FormatContext { // birth 469
    insertionMode: InsertionMode;
    selectedValue: SelectedValue; // null when none
    tagScope: TagScope;
    viewTransition: ViewTransitionContext | null;
  }
  interface ViewTransitionContext { // birth 540
    update: ViewTransitionValue;
    enter: ViewTransitionValue;
    exit: ViewTransitionValue;
    share: ViewTransitionValue;
    name: ViewTransitionValue;
    autoName: ViewTransitionValue;
    nameIdx: int32;
  }
  interface HoistableState { styles: Set<StyleQueue>; stylesheets: Set<StylesheetResource>; suspenseyImages: boolean } // birth 2490
  interface StyleQueue { precedence: Chunk; rules: Chunk[]; hrefs: Chunk[]; sheets: Map<string, StylesheetResource> } // birth 1610 1762 2746
  interface StylesheetResource { state: StylesheetState; props: PropsBag } // birth 1617 2753: props is what assign() made

  // -------------------------------------------------------------------------------------------------------------------
  // 8. The stacks a task carries
  // -------------------------------------------------------------------------------------------------------------------
  interface ContextNode { // birth 4781. React's ContextSnapshot = ContextNode | null
    parent: ContextNode | null;
    depth: ContextDepth;
    context: ReactContext;
    parentValue: ContextValue;
    value: ContextValue;
  }
  interface ComponentStackNode { parent: ComponentStackNode | null; type: ElementType } // birth 3969 3977 (type "Suspense Fallback")
  interface TreeContext { id: TreeId; overflow: string } // birth 3037 3053 3061

  // -------------------------------------------------------------------------------------------------------------------
  // 9. Hooks, the tables of functions handed to react and react-dom, classes
  // -------------------------------------------------------------------------------------------------------------------
  interface Hook { memoizedState: HookState; queue: UpdateQueue | null; next: Hook | null } // birth 3157
  interface UpdateQueue { last: Update | null; dispatch: Dispatch | null } // birth 3218: last is never stored again, never read
  interface Update { action: HookState; next: Update | null } // birth 3258
  interface RefObject { current: any } // birth 3371: handed to the user, kept in Hook.memoizedState
  type Dispatch = (action: any) => void;
  type Reducer = (state: any, action: any) => any;
  /** births 3304 3334: a function; 3308 stores a member on the first */
  interface ActionDispatch { (payload: any): void; $$FORM_ACTION?: (prefix: any) => CustomFormFields }
  /** var HooksDispatcher: FZ.Dispatcher = { .. }: the function expressions in it then need no annotation. react reads it by name off SharedInternals.H */
  interface Dispatcher { // birth 3349
    readContext(context: ReactContext): ContextValue;
    use(usable: any): any;
    useContext(context: ReactContext): ContextValue;
    useMemo(nextCreate: () => any, deps?: HookDeps): any;
    useReducer(reducer: Reducer, initialArg: any, init?: (initialArg: any) => any): DispatchTuple;
    useRef(initialValue: any): RefObject;
    useState(initialState?: any): DispatchTuple;
    useInsertionEffect(create?: GivenFunction, deps?: HookDeps): void;
    useLayoutEffect(create?: GivenFunction, deps?: HookDeps): void;
    useCallback(callback: GivenFunction, deps?: HookDeps): GivenFunction;
    useImperativeHandle(ref?: Ref, create?: GivenFunction, deps?: HookDeps): void;
    useEffect(create?: GivenFunction, deps?: HookDeps): void;
    useDebugValue(value?: any, formatterFn?: GivenFunction): void;
    useDeferredValue(value: any, initialValue?: any): any;
    useTransition(): TransitionTuple;
    useId(): string;
    useSyncExternalStore(subscribe: GivenFunction, getSnapshot: GivenFunction, getServerSnapshot?: GivenFunction): any;
    useOptimistic(passthrough: any, reducer?: GivenFunction): OptimisticTuple;
    useActionState(action: FormAction, initialState: any, permalink?: PropValue): ActionStateTuple;
    useFormState(action: FormAction, initialState: any, permalink?: PropValue): ActionStateTuple;
    useHostTransitionStatus(): FormStatusNotPending;
    useMemoCache(size: number): any[];
    useCacheRefresh(): () => void;
    useEffectEvent(callback?: GivenFunction): () => void;
  }
  interface AsyncDispatcher { getCacheForType(resourceType?: GivenFunction): any; cacheSignal(): any } // birth 3446: both throw
  interface FormStatusNotPending { pending: boolean; data: null; method: null; action: null } // birth 211: handed to the user
  /** stored by name to DOMSharedInternals.d: react-dom reads it by name */
  interface HostDispatcher { // birth 218
    f: GivenFunction; // previousDispatcher.f
    r: GivenFunction; // previousDispatcher.r
    D(href: PropValue): void;
    C(href: PropValue, crossOrigin?: PropValue): void;
    L(href: PropValue, as: PropValue, options?: Options): void;
    m(href: PropValue, options?: Options): void;
    X(src: PropValue, options?: Options): void;
    S(href: PropValue, precedence?: PropValue, options?: Options): void;
    M(src: PropValue, options?: Options): void;
  }
  /** stored by name to ClassInstance.updater: react's Component.prototype.setState calls it by name, with (inst, payload, callback, "setState") */
  interface ClassComponentUpdater { // birth 3025
    enqueueSetState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueReplaceState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueForceUpdate(inst?: ClassInstance, callback?: any): void;
  }
  interface InternalInstance { queue: any[] | null; replace: boolean } // birth 4269: stored by name to ClassInstance._reactInternals, comes back as any (3027 3031)

  // -------------------------------------------------------------------------------------------------------------------
  // 10. Small things
  // -------------------------------------------------------------------------------------------------------------------
  /** BORN EMPTY: {}. The one member says: there is no member: so that no other shape is assignable to it. Made for every function component rendered; compared by === (dispatchAction) */
  interface ComponentIdentity { readonly $$fzIdentity?: never } // birth 4190
  /** BORN EMPTY: {}. emptyContextObject: handed to the user's classes as their context */
  interface EmptyContext { readonly $$fzEmptyContext?: never } // birth 2957
  interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } } // birth 3479 (not in births.txt)
}

// ---------------------------------------------------------------------------------------------------------------------
// Globals the bundle names and the checker's library (ES only) lacks. Delete this block when a real library is in.
// ---------------------------------------------------------------------------------------------------------------------
declare var require: (name: string) => any;
declare var exports: any;
declare var console: { error(...data: any[]): void };
declare var Buffer: { byteLength(chunk: string, encoding: string): number };
declare var Bun: { hash(data: string): number | bigint };
declare var ReadableStream: new (source: any, strategy?: any) => FZ.WebReadableStream;
declare var Headers: new (init?: any) => any;
declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function queueMicrotask(callback: () => void): void;

// ---------------------------------------------------------------------------------------------------------------------
// A. THE MODULE-LEVEL VARIABLES (90 declarators in 31 statements). Not listed = a constant symbol | regular expression |
//    string: leave it to inference (the 18 REACT_*, MAYBE_ITERATOR_SYMBOL, the 12 patterns, actionJavaScriptURL, isomorphicReactPackageVersion..: 33). The other 57:
// ---------------------------------------------------------------------------------------------------------------------
//   12 React                                       FZ.ReactModule
//   13 ReactDOM                                    FZ.ReactDOMModule
//   39 isArrayImpl                                 inference (Array.isArray: a type guard to any[])
//   40 scheduleMicrotask                           inference
//   55 assign                                      FZ.Assign
//   56 hasOwnProperty                              inference
//   60 illegalAttributeNameCache                   FZ.NameCache
//   61 validatedAttributeNameCache                 FZ.NameCache
//   71 unitlessNumbers                             Set<string>            (inference gives it)
//   76 aliases                                     Map<string, string>    (inference gives it)
//  207 ReactSharedInternals                        FZ.SharedInternals
//  209 ReactDOMSharedInternals                     FZ.DOMSharedInternals
//  211 sharedNotPendingObject                      FZ.FormStatusNotPending
//  217 previousDispatcher                          FZ.HostDispatcherGiven
//  218 ReactDOMSharedInternals.d = { .. }          no variable: the literal goes into any: = { .. }/*$*/ as FZ.HostDispatcher/*$*/;
//  229 PRELOAD_NO_CREDS                            FZ.PreloadState
//  230 currentlyFlushingRenderState                FZ.RenderState | null
//  581 styleNameCache                              Map<string, FZ.Chunk>
// 1064 validatedTagCache                           Map<string, FZ.Chunk>
// 2107 endTagCache                                 Map<string, FZ.Chunk>
// 2274 currentlyRenderingBoundaryHasStylesToHoist  boolean
// 2275 destinationHasCapacity                      boolean
// 2315 stylesheetFlushingQueue                     FZ.Chunk[]
// 2903 bind                                        inference
// 2957 emptyContextObject                          FZ.EmptyContext
// 2958 currentActiveSnapshot                       FZ.ContextNode | null
// 3025 classComponentUpdater                       FZ.ClassComponentUpdater
// 3037 emptyTreeContext                            FZ.TreeContext
// 3066 clz32                                       (x: number) => number
// 3067 log · 3068 LN2                              inference
// 3074 SuspenseException                           inference (Error)
// 3118 suspendedThenable                           FZ.Thenable            (null when none)
// 3131 objectIs                                    (x: any, y: any) => boolean
// 3132 currentlyRenderingComponent                 FZ.ComponentIdentity | null
// 3133 currentlyRenderingTask                      FZ.Task | null
// 3134 currentlyRenderingRequest                   FZ.Request | null
// 3135 currentlyRenderingKeyPath                   FZ.KeyNode | null
// 3136 firstWorkInProgressHook                     FZ.Hook | null
// 3137 workInProgressHook                          FZ.Hook | null
// 3138 isReRender · 3139 didScheduleRenderPhaseUpdate   boolean
// 3140 localIdCounter · 3141 actionStateCounter · 3142 actionStateMatchingIndex · 3143 thenableIndexCounter   FZ.HookCounter
// 3144 thenableState                               FZ.ThenableState | null
// 3145 renderPhaseUpdates                          Map<FZ.UpdateQueue, FZ.Update> | null
// 3146 numberOfReRenders                           FZ.HookCounter
// 3349 HooksDispatcher                             FZ.Dispatcher
// 3445 currentResumableState                       FZ.ResumableState | null
// 3446 DefaultAsyncDispatcher                      FZ.AsyncDispatcher
// 3454 prefix · 3455 suffix                        string | undefined
// 3472 reentry                                     boolean
// 3803 currentRequest                              FZ.Request | null
// 6128 flushedByteSize                             FZ.ByteSize
// 6312 flushingPartialBoundaries                   boolean

// ---------------------------------------------------------------------------------------------------------------------
// B. A PARAMETER'S NAME SAYS ITS TYPE, in all 161 functions, so that the 12 pieces agree. THE TYPE THAT ARRIVES (rule 4a's name$given).
// ---------------------------------------------------------------------------------------------------------------------
// request request$jscomp$0                  FZ.Request
// task                                        FZ.Task
// destination                                 FZ.Destination
// target target$jscomp$0                      FZ.Chunk[]             (adoptPreloadCredentials: FZ.PropsBag)
// renderState · resumableState                FZ.RenderState · FZ.ResumableState
// preambleState                               FZ.PreambleState       (pushStartInstance: | null)
// formatContext parentContext parentFormatContext rootFormatContext   FZ.FormatContext
// hoistableState                              FZ.HoistableState | null   (never null: writeHoistablesForBoundary writeStyleResourceDependenciesInJS hasSuspenseyContent flushSegmentContainer)
// parentState childState                      FZ.HoistableState
// inheritedHoistables                         FZ.HoistableState | null
// segment                                     FZ.Segment             (finishedTask: | null)
// boundary                                    FZ.SuspenseBoundary    (| null: createPendingSegment abortRemainingReplayNodes finishedSegment finishedTask)
// blockedBoundary · blockedSegment · blockedPreamble   FZ.SuspenseBoundary | null · FZ.Segment · FZ.PreambleState | null
// row previousRow unblockedRow                FZ.SuspenseListRow | null   (finishSuspenseListRow's row, togetherRow: never null)
// abortSet fallbackAbortableTasks             Set<FZ.Task>
// contentPreamble fallbackPreamble (createSuspenseBoundary)   FZ.PreambleState | null
// keyPath                                     FZ.KeyNode             (createRenderTask createReplayTask: | null) · parentKeyPath: FZ.KeyNode | null
// context                                     FZ.ContextNode | null  
// prev next · newSnapshot                     FZ.ContextNode · FZ.ContextNode | null
// treeContext baseContext                     FZ.TreeContext
// componentStack node$jscomp$0 (getThrownInfo)   FZ.ComponentStackNode | null
// thenableState                               FZ.ThenableState | null   (trackUsedThenable: never null)
// replay · nodes · slots                      FZ.ReplaySet · FZ.ReplayNode[] · FZ.ResumeSlots
// trackedPostpones                            FZ.PostponedHoles
// node                                        FZ.ReactNode           (addToReplayParent: FZ.ReplayNode)
// children                                    FZ.ReactNode           (renderChildrenArray: FZ.ReactNode[]) · rows: FZ.ReactNode (NOT an array type)
// props · type · ref                          FZ.Props · FZ.ElementType (string: getChildFormatContext pushStartInstance) · FZ.Ref
// Component · secondArg · fn                  FZ.FunctionComponent · any · FZ.ElementType
// styleQueue · stylesheet · resource          FZ.StyleQueue · FZ.StylesheetResource · FZ.Resource
// collectedPreambleSegments                   FZ.Segment[][]
// errorInfo · errorDigest$jscomp$0            FZ.ThrownInfo · FZ.ErrorDigest
// error reason                                FZ.Thrown
// thenable                                    FZ.Thenable
// options                                     FZ.Options
// value style innerHTML href as src crossOrigin precedence formEncType formMethod formTarget revealOrder
//   text url input permalink initialState initialArg state action maybeIterable params key   FZ.PropValue or the nearer GIVEN alias: all any
// formAction · nonce · importMap · selectedValue · formState   FZ.FormAction · FZ.Nonce · FZ.ImportMap · FZ.SelectedValue · FZ.ReactFormState
// identifierPrefix externalRuntimeConfig bootstrapScriptContent bootstrapScripts bootstrapModules maxHeadersLength namespaceURI   FZ.PropValue (off the options)
// progressiveChunkSize onError onAllReady onShellReady onShellError onFatalError onPostpone   as in FZ.RequestConstructor · onHeaders: FZ.OnHeaders | undefined
// name tag attributeName match prefix s suffix   string   (FZ.PropValue: pushFormActionAttribute's and describeBuiltInComponentFrame's name)
// chunk                                       FZ.Chunk
// childIndex                                  FZ.ChildIndex
// id segmentId                                FZ.SegmentId
// index totalChildren actionStateCount actionStateMatchingIndex   FZ.int32 · insertionMode: FZ.InsertionMode · tagScope: FZ.TagScope
// textEmbedded lastPushedText construct shellComplete   boolean
// viewTransition parentViewTransition         FZ.ViewTransitionContext | null
// preloadState                                FZ.PreloadState
// reducer · init · nextCreate · deps          FZ.Reducer · ((initialArg: any) => any) | undefined · () => any · FZ.HookDeps
// componentIdentity · queue                   FZ.ComponentIdentity · FZ.UpdateQueue
// controller                                  FZ.StreamController
// x y                                         number (clz32Fallback) · any (is)
// `this`: FZ.Chunk[] pushAdditionalFormField · FZ.Destination flushStyleTagsLateForBoundary flushResource flushStyleInPreamble flushStylesInPreamble
//   preloadLateStyle preloadLateStyles · FZ.HoistableState hoistStyleQueueDependency hoistStylesheetDependency · FZ.Request abortTaskSoft RequestInstance

// ---------------------------------------------------------------------------------------------------------------------
// C. RESULTS that callers in other pieces lean on. Not listed = void, or plain to inference.
// ---------------------------------------------------------------------------------------------------------------------
// string: escapeTextForBrowser scriptReplacer styleReplacer escapeJS*ForInstructionScripts getPreloadAsHeader the two escape*Replacer
//   describeBuiltInComponentFrame describeNativeComponentFrame describeComponentStackByType · FZ.ComponentName: getComponentNameFromType
// FZ.Chunk: startChunkForTag endChunkForTag · number: byteLengthOfChunk clz32Fallback
// boolean: isAttributeNameSafe pushTextInstance writeBootstrap writeStartPendingSuspenseBoundary writeStartSegment writeEndSegment hasStylesToHoist
//   writeHoistablesForBoundary hasSuspenseyContent is isEligibleForOutlining preparePreambleFromSubtree preparePreambleFromSegment
//   flushSubtree flushSegment flushSegmentContainer flushCompletedBoundary flushPartiallyCompletedSegment
// null: pushLinkImpl pushSelfClosing pushTitleImpl pushScriptImpl defaultErrorHandler
// FZ.ReactNode: pushStartSingletonElement pushStartGenericElement pushStartInstance renderWithHooks · any: trackUsedThenable unwrapThenable basicStateReducer useMemo
// sanitizeURL<T>(url: T): T | string · getIteratorFn: FZ.IteratorFn
// getCustomFormFields: FZ.CustomFormFields · pushFormActionAttribute: FZ.FormDataGiven · flattenOptionChildren: string
// createRenderState: FZ.RenderState · createResumableState: FZ.ResumableState · createPreambleState: FZ.PreambleState · createHoistableState: FZ.HoistableState
// createFormatContext createRootFormatContext getChildFormatContext getSuspenseFallbackFormatContext getSuspenseContentFormatContext: FZ.FormatContext
// getSuspenseViewTransition: FZ.ViewTransitionContext | null · pushTreeContext: FZ.TreeContext
// getSuspendedThenable: FZ.Thenable · getThenableStateAfterSuspending: FZ.ThenableState | null · resolveCurrentlyRenderingComponent: FZ.ComponentIdentity
// createHook createWorkInProgressHook: FZ.Hook · useReducer: FZ.DispatchTuple · useActionState: FZ.ActionStateTuple
// createRequest: FZ.Request
// createSuspenseBoundary: FZ.SuspenseBoundary · createRenderTask createReplayTask spawnNewSuspendedReplayTask spawnNewSuspendedRenderTask: FZ.Task
// createPendingSegment: FZ.Segment · createSuspenseListRow: FZ.SuspenseListRow
// replaceSuspenseComponentStackWithSuspenseFallbackStack: FZ.ComponentStackNode | null · getThrownInfo: FZ.ThrownInfo · logRecoverableError: FZ.ErrorDigest
// trackPostponedBoundary: FZ.ReplayNode
// renderNode renderNodeDestructive retryNode: void (they `return` the void of one another)

// ---------------------------------------------------------------------------------------------------------------------
// D. BIRTHS LEFT WITHOUT AN INTERFACE, ON PURPOSE: literals handed straight to a built-in, to given code, or to a for..in of ours, never stored to again.
// ---------------------------------------------------------------------------------------------------------------------
// 3534 3998 { value } 3486 { set } 3982 { configurable, enumerable, get } -> Object.defineProperty
// 5662 { Link } | {} -> onHeaders · 6694 { type, pull, cancel } 6718 { highWaterMark } -> ReadableStream
// 1940 5641 -> getPreloadAsHeader's params (for..in) · 1955 2355 2520 2570 -> pushLinkImpl's props (for..in) · 1619 { data-precedence, precedence } -> a source of assign()
// DICTIONARIES, NOT LAYOUTS (section 3): 326 381 and the first arguments of assign (1619 1689 2615 2629 2647 2681 2726 2756 2783 2809 4253 4282 4324): FZ.PropsBag ·
//   298 452 { default, anonymous, credentials }: FZ.ConnectResources

// ---------------------------------------------------------------------------------------------------------------------
// E. THE VARIABLES THAT HOLD TWO OR MORE KINDS OF OBJECT. p = a parameter (rule 4a) · l = a local (rule 4c: a marked variable a role).
//    `a > b` = holds a, later b. given = any. What is not listed holds one kind of object at most, beside numbers | strings | booleans | null | undefined.
//    A variable that STARTS as any (var key = node.key) stays any for the checker: a born literal stored to it is checked against nothing: split that role off too.
//    E1: FUNCTIONS WHOSE TEXT IS 19.3.0's TO THE LETTER (118 of the 161, compared by program): found by program there, they hold here.
//    E2: FUNCTIONS WHOSE TEXT DIFFERS (43): read off THIS text. Those not listed under E2 (renderSuspenseListRows renderElement renderNode abortRemainingReplayNodes
//        abortTask finishedTask performWork flushSegment flushCompletedBoundary flushCompletedQueues): THE ROLES ARE THOSE MARKED IN parts/NN.cts, AND splits.py IS THEIR JUDGE: 19.3.0's list is no guide: the minifier shares the names otherwise.
// ---------------------------------------------------------------------------------------------------------------------
// E1
// getSuspenseContentFormatContext p resumableState > ViewTransitionContext | null
// hoistPreambleState p renderState > PreambleState · writeBootstrap p renderState > Chunk[], l i int32 > Chunk · flushStylesInPreamble p styleQueue > int32 · preloadLateStyle p stylesheet > int32
// prefetchDNS preconnect preload   l resumableState ResumableState > PreloadHeaders | null (> Resource in preload) · l header string > Resource (prefetchDNS)
//   l bucket ConnectBucket > Resource (preconnect) · l imageSrcSet given > Resource > ResourceDict (preload) · p href given > PropsBag (2681)
// preinitStyle p precedence given > StylesheetResource (2753), l renderState RenderState > Resource | undefined
// preinitScript preinitModuleScript   p src given > Resource | undefined > Resource · p options given > PropsBag
// useReducer p reducer Reducer > state > UpdateQueue (3218) > Dispatch · p initialArg given > Dispatch | null · p init > Update | undefined | null · l queue UpdateQueue | null > state
// dispatchAction p componentIdentity ComponentIdentity > Update (3258) · p action given > Update | undefined · p queue UpdateQueue > Update
// HooksDispatcher.useRef initialValue given > RefObject (3371) · useActionState p action given > ActionDispatch (3304), l request Request | null > ReactFormState
// completeAll p request > () => void
// renderWithHooks p request > ReactNode · finishFunctionComponent p keyPath KeyNode > TreeContext · p actionStateCount int32 > KeyNode | null · l segment Segment | null > Chunk[]
// renderNodeDestructive p node given > ComponentStackNode | null
// finishedSegment p segment > Chunk[] · trackUsedThenable p thenableState ThenableState > Thrown > Thenable, p index int32 > Thenable | undefined
// flushSubtree p request > RenderState > string · p segment > Segment[] · p hoistableState > SegmentId · l r boolean > Segment > boolean
// flushPartiallyCompletedSegment p request > RenderState · p boundary > ResumableState · p destination > boolean · l segmentID SegmentId > string
// E2
// createRenderState (once a request: cold)   p importMap given > PreloadHeaders | null > int32 > string | undefined · p onHeaders OnHeaders > RenderState · p nonce given > int32
//   p maxHeadersLength given > string | undefined · l idPrefix string > given > ResumableState > Resource · l nonceStyle given > string | undefined > given > ResumableState > Resource
//   l inlineStyleWithNonce string > PropsBag (326) > string · l inlineScriptWithNonce string > string | undefined > PropsBag (381) · l bootstrapScriptContent given > Chunk[] (267) > string
// preloadModule l as string > Resource
// describeNativeComponentFrame l RunInRootFrame > int32 · l namePropDescriptor PropertyDescriptor | undefined > int32 · l Fake a function > boolean > given
// createRequest p resumableState > Request · p renderState > Segment · p children > Task
// createSuspenseBoundary p fallbackAbortableTasks Set<Task> > SuspenseBoundary (3823) · p contentPreamble PreambleState | null > SuspenseBoundary[] | null · p request > HoistableState | null
// logRecoverableError p request > ErrorHandler, p error > the handler's result · completeShell p request > () => void
// retryNode p request > SuspenseBoundary | null · l node given > int32 · l childIndex ChildIndex > ReplayNode[] > string > Segment | null · l key given > KeyNode (4875) > Request · l type given > SegmentId
//   l props given > ThrownInfo > ErrorDigest | SuspenseBoundary | ReactNode[] · l ref given > ReplayNode[] · l name given > ResumeSlots · l keyOrIndex given > ReplayNode[] · l replay ReplaySet > ErrorDigest
//   l node$jscomp$0 ReplayNode > ResumeSlots · l childNodes ReplayNode[] > ThrownInfo > Task > given (_init, the iterator function, the iterator). 19.3.0's childSlots and currentNode are not here
// renderChildrenArray p request IS NOT STORED TO · p children ReactNode[] > ThrownInfo > ErrorDigest · p childIndex ChildIndex > ReplayNode[] > int32 > given · l replay ReplaySet > TreeContext
//   l replayNodes ReplayNode[] > int32 · l j int32 > ResumeSlots > int32 · l node ReplayNode > ResumeSlots > given · l boundary SuspenseBoundary | null > SegmentId | undefined. 19.3.0's thrownInfo is not here
// trackPostponedBoundary p request > KeyNode | null · p boundary > ReplayNode (5223). 19.3.0's tracked is not here
// trackPostpone p request > ResumeSlots · p task > ReplayNode | undefined · l boundary SuspenseBoundary | null > Map<KeyNode, ReplayNode>
// untrackBoundary p request > PostponedHoles | null · p boundary > KeyNode | null > ReplayNode | undefined

// ---------------------------------------------------------------------------------------------------------------------
// F. IDIOMS, probed on the checker
// ---------------------------------------------------------------------------------------------------------------------
// catch (x: FZ.Thrown) · new Set<FZ.Task>() (3719 4554 4963; 5509 takes it from the parameter) · new Map<FZ.KeyNode, FZ.ReplayNode>() comes by itself where the literal around it is typed
// an array literal becomes a tuple only against its type: var fallbackKeyPath: FZ.KeyNode = [..] · var fallbackReplayNode: FZ.ReplayNode = [..]
// dict.hasOwnProperty(key) is Object's own method, not the index signature · delete slots[i] and for (var index in slots) pass on FZ.SlotMap · slots[i] reads as SegmentId | undefined BY THE ALIAS: no cast; "number" === typeof narrows both branches (the other dictionaries are only read behind hasOwnProperty: their values carry no undefined)
// var bucket: FZ.ConnectBucket | FZ.Resource · boundary.length = 4 passes on FZ.ReplayNode (5316)
// pushAllNext(newSnapshot!) (3015): TS2345: `bang` does not put that one · task.replay! task.blockedSegment! wherever React knows which kind of task it holds
