// fz-shapes.d.ts: the shapes of react-dom 19.3.0, cjs/react-dom-server.bun.production.js (Fizz). READ OFF THE BUNDLE'S OWN BIRTHS:
// the members of an interface stand in the order in which the birth STORES them (a chain this.a = this.b = 0 stores b first).
// "birth NNNN" = line of original.js. "given" = the value is made elsewhere (react, react-dom, Bun, Node, the user).
// CHECKED BY PROGRAM: the 63 births named behind the heads have their interface's members, in its order, and fit its types; no two births of one interface differ.
// THE CHECKER DOES NOT LOOK INTO A .d.ts (it says "0 files"; a name that does not exist there is silently any): python3 shapes_check.py checks all fz-shapes*.d.ts as .ts, and the births again.
declare namespace FZ {
  // -------------------------------------------------------------------------------------------------------------------
  // 1. Numbers. int32: four bytes and integer arithmetic; the build proves every value that is stored there, or stops.
  // -------------------------------------------------------------------------------------------------------------------
  type int32 = import("bun").int32;
  type RequestStatus = int32; // Request.status: 10 OPENING 11 OPEN 12 CLOSING 13 CLOSED (aborting is the flag Request.aborted)
  type SegmentStatus = int32; // Segment.status: 0 PENDING 1 COMPLETED 2 FLUSHED 3 ABORTED 4 ERRORED 5 POSTPONED
  type BoundaryStatus = int32; // SuspenseBoundary.status: 0 PENDING 1 COMPLETED 4 CLIENT_RENDERED 5 POSTPONED
  type StylesheetState = int32; // StylesheetResource.state: 0 PENDING 1 PRELOADED 2 PREAMBLE 3 LATE
  type InsertionMode = int32; // 0 ROOT_HTML 1 HTML_HTML 2 HTML 3 HTML_HEAD 4 SVG 5 MATHML 6 TABLE 7 TABLE_BODY 8 TABLE_ROW 9 COLGROUP
  type TagScope = int32; // bits: 1 NOSCRIPT 2 PICTURE 4 FALLBACK 8 EXIT 16 ENTER 32 UPDATE 64 APPEARING
  type InstructionState = int32; // bits: 1 $RS 2 $RC 4 $RX 8 $RR 16 form replay 32 shell id 64 shell time 128 needs view transitions 256 sent them
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
  type Recoverable = any; // { $$typeof: REACT_RECOVERABLE_TYPE, _reason }: react's browser() makes it
  type Thrown = any; // what a catch clause holds, Request.fatalError, abort's reason
  type HookState = any; // Hook.memoizedState: state · [value, deps] · RefObject; Update.action
  type HookDeps = any; // the user's array of dependencies: never tested to be one. null | undefined when none
  type IteratorFn = any; // getIteratorFn's result (null when none), and the iterator and steps it gives
  type Destination = any; // Bun's direct stream controller | a Node Writable | a FakeWritable (born here): read by name. null when none
  type StreamController = any;
  type NodeReadable = any;
  type WebReadableStream = any;
  type AbortSignalGiven = any;
  type AbortControllerGiven = any; // new AbortController(). null until attachAbortSignal
  type TextEncoderGiven = any;
  type Options = any; // the bag an exported function is handed; the bag of preload | preloadModule | preinit*
  type PostponedStateGiven = any; // the second argument of resume*: a PostponedState born here OR WHAT JSON.parse MADE OF ONE. See section 6
  type ReactFormState = any; // options.formState: [state, keyPath, referenceId, boundArgumentCount]. null when none
  type FormAction = any; // a server action: $$FORM_ACTION $$IS_SIGNATURE_EQUAL bind
  type CustomFormFields = any; // what $$FORM_ACTION gives: name action encType method target data. null when none
  type FormDataGiven = any; // null when none
  type Nonce = any; // options.nonce | .script | .style: a string or undefined by React's types; null and 0 get through
  type SelectedValue = any; // <select>'s value | defaultValue. null when none
  type ViewTransitionValue = any; // a prop of <ViewTransition> (or "auto" | "none" | an id made here): taken for a string, never tested
  type BootstrapScriptContent = any; // options.bootstrapScriptContent: string | undefined
  type BootstrapScripts = any; // options.bootstrapScripts | bootstrapModules: Array<string | { src, integrity, crossOrigin }> | undefined
  type ImportMap = any;
  type ReactModule = any; // require("react"): Children version __CLIENT_INTERNALS..
  type ReactDOMModule = any; // require("react-dom")
  type UtilModule = any; // require("util")
  type StreamModule = any; // require("stream")
  type SharedInternals = any; // react's { H, A, T, S .. }: H and A are stored by name (performWork)
  type DOMSharedInternals = any; // react-dom's { d, p, findDOMNode }: d is stored by name (226)
  type HostDispatcherGiven = any; // previousDispatcher: react-dom's own { f r D C L m X S M }
  type GivenFunction = any;

  // -------------------------------------------------------------------------------------------------------------------
  // 3. Chunks, dictionaries, tuples
  // -------------------------------------------------------------------------------------------------------------------
  type Chunk = string; // the Bun bundle has no stringToChunk: a chunk IS the string; writeChunk tests .length, Buffer.byteLength measures it
  type PrecomputedChunk = string; // no stringToPrecomputedChunk either
  type Resource = Chunk[]; // a <link> | <script> as chunks; emptied by .length = 0 when flushed or adopted

  // DICTIONARIES: born {} (or by Object.assign, or by JSON.parse) and read by a computed name: plain objects, no layout.
  type PropsBag = { [name: string]: any }; // props MADE here: {} 4582 5217 · 340 395 (members are ADDED behind the birth) · every first argument and result of assign()
  type Assign = (target: PropsBag, ...sources: any[]) => PropsBag; // var assign: so that its literal first arguments are checked as dictionaries
  type NameCache = { [name: string]: boolean }; // births 67 68
  type PreloadState = PropValue[]; // [] (PRELOAD_NO_CREDS, one array, compared by .length) | [crossOrigin, integrity] births 2714 2732 2791 6166
  type ResourceDict = { [key: string]: PreloadState | null }; // null = Exists. births 310 313 314 467..469 471 2742 2799 7313 7315
  type ExistsDict = { [key: string]: null }; // births 311 312 465 466
  type UnknownResourceDict = { [as: string]: ResourceDict }; // births 464 470 7308 ({ font }) 7314
  type ConnectBucket = "default" | "anonymous" | "credentials";
  type ConnectResources = { [bucket: string]: ExistsDict }; // births 312 466: { default, anonymous, credentials }: only ever read as [bucket]
  type SlotMap = { [index: string]: SegmentId | undefined }; // births 5764 5776 5781; stored: segment.id alone (5787); READ FOR EVERY CHILD INDEX, also those without a slot, and told apart by "number" === typeof (4431 5669): undefined = absent; members are deleted as they are resumed (4434 5672 6015)
  type ThrownInfo = { [name: string]: unknown }; // births 4308 6175 6558 7205 7221: {}; componentStack is an ACCESSOR put by Object.defineProperty. Only handed to onError

  // TUPLES: arrays the bundle builds; JSON.stringify sees the first (useActionState) and the second (the postponed state).
  type KeyNode = [parent: KeyNode | null, name: ComponentName, keyOrIndex: KeyOrIndex]; // births 5044 5195 5349 5516 5610
  /**
   * births 5046 5758 5777 7275 (4 long) 5703 (6 long). ONE TYPE: the bundle makes a 4 into a 6 by stores (5715 5716) and a 6 into a 4 by .length = 4 (5799).
   * 4 === node.length tells them apart but does not narrow: node[4]! node[5]! in the other branch.
   */
  type ReplayNode = [name: ComponentName, keyOrIndex: KeyOrIndex, children: ReplayNode[], slots: ResumeSlots, fallback?: ReplayNode | null, rootSegmentID?: SegmentId];
  type ResumeSlots = SlotMap | SegmentId | null; // null nothing · a number: resume at the root position (-1: 7302) · a map: child index -> segment id
  type ThenableState = Thenable[]; // birth 3477
  type MemoState = [value: any, deps: HookDeps]; // birth 3381, in Hook.memoizedState
  type DispatchTuple = [state: HookState, dispatch: Dispatch | null]; // births 3339 3341 3358
  type OptimisticTuple = [state: HookState, dispatch: Dispatch]; // birth 3551
  type TransitionTuple = [isPending: boolean, start: (callback?: GivenFunction) => void]; // birth 3530
  type ActionStateTuple = [state: HookState, dispatch: ActionDispatch, isPending: boolean]; // births 3463 3466
  type ComponentFrameSample = [sample: string | null, control: string | null]; // births 3663 3665

  // -------------------------------------------------------------------------------------------------------------------
  // 4. Request
  // -------------------------------------------------------------------------------------------------------------------
  interface Request { // birth 3872 RequestInstance
    destination: Destination; // null when none
    flushScheduled: boolean;
    resumableState: ResumableState;
    renderState: RenderState;
    rootFormatContext: FormatContext;
    progressiveChunkSize: number; // 12800 | options.progressiveChunkSize (given: React's type says number)
    status: RequestStatus;
    fatalError: Thrown; // null until fatalError() | abort()
    aborted: boolean;
    nextSegmentId: number;
    allPendingTasks: number;
    pendingRootTasks: number;
    completedRootSegment: Segment | null;
    completedPreambleSegments: Segment[][] | null;
    byteSize: ByteSize;
    abortableTasks: Set<Task>;
    pingedTasks: Task[];
    currentTask: Task | null;
    clientRenderedBoundaries: SuspenseBoundary[];
    completedBoundaries: SuspenseBoundary[];
    partialBoundaries: SuspenseBoundary[];
    trackedPostpones: PostponedHoles | null;
    postponedState: PostponedState | null;
    onError: ErrorHandler;
    onBrowserBailout: BailoutHandler;
    onAllReady: () => void;
    onShellReady: () => void;
    onShellError: (error: Thrown) => void;
    onFatalError: (error: Thrown) => void;
    renderLifetimeController: AbortControllerGiven; // null until attachAbortSignal
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
      onBrowserBailout: BailoutHandler | undefined,
      onAllReady: (() => void) | undefined,
      onShellReady: (() => void) | undefined,
      onShellError: ((error: Thrown) => void) | undefined,
      onFatalError: ((error: Thrown) => void) | undefined,
      formState: ReactFormState
    ): Request;
    (this: Request,
      resumableState: ResumableState,
      renderState: RenderState,
      rootFormatContext: FormatContext,
      progressiveChunkSize: number | undefined,
      onError: ErrorHandler | undefined,
      onBrowserBailout: BailoutHandler | undefined,
      onAllReady: (() => void) | undefined,
      onShellReady: (() => void) | undefined,
      onShellError: ((error: Thrown) => void) | undefined,
      onFatalError: ((error: Thrown) => void) | undefined,
      formState: ReactFormState
    ): void;
  }
  type ErrorHandler = (error: Thrown, errorInfo: ThrownInfo) => any; // the user's, or defaultErrorHandler. The result: a digest; what is no string | null | undefined is dropped
  type BailoutHandler = (error: Thrown, errorInfo: ThrownInfo) => void; // the user's, or noop
  type ErrorDigest = string | null | undefined; // logRecoverableError's result

  // -------------------------------------------------------------------------------------------------------------------
  // 5. Task, Segment, SuspenseBoundary, SuspenseListRow
  // -------------------------------------------------------------------------------------------------------------------
  /** React's RenderTask (4186: replay null, blockedSegment a Segment) and ReplayTask (4239: replay a ReplaySet, blockedSegment null): THE SAME MEMBERS IN THE SAME ORDER, and resumeNode (5306) turns one into the other and back: ONE SHAPE */
  interface Task { // birth 4186 4239
    replay: ReplaySet | null;
    node: ReactNode;
    childIndex: ChildIndex;
    ping: Ping;
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
  interface Ping { resolve: () => void; reject: (error: Thrown) => void } // birth 4190 4243: handed to thenable.then(ping.resolve, ping.reject)
  interface Segment { // birth 4278
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
  interface SuspenseBoundary { // birth 4136
    status: BoundaryStatus;
    rootSegmentID: number;
    parentFlushed: boolean;
    pendingTasks: number;
    row: SuspenseListRow | null;
    completedSegments: Segment[];
    byteSize: ByteSize;
    defer: boolean; // false at every call in this bundle
    fallbackAbortableTasks: Set<Task>;
    errorDigest: ErrorDigest;
    contentState: HoistableState;
    fallbackState: HoistableState;
    preamble: BoundaryPreamble | null;
    tracked: TrackedBoundary | null;
  }
  interface BoundaryPreamble { content: PreambleState; fallback: PreambleState } // birth 5015 5443
  interface TrackedBoundary { contentKeyPath: KeyNode | null; fallbackNode: ReplayNode | null } // birth 5056: never null at the one birth; React's type has the nulls and 5694 tests for one
  interface SuspenseListRow { // birth 4395
    pendingTasks: number;
    boundaries: SuspenseBoundary[] | null;
    hoistables: HoistableState;
    inheritedHoistables: HoistableState | null;
    together: boolean;
    next: SuspenseListRow | null;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 6. Postponing and replaying.
  //    THE BORDER: resume* are handed a PostponedStateGiven (any). What is read off it (resumableState rootFormatContext
  //    progressiveChunkSize nextSegmentId replayNodes replaySlots: 4018..4077 7404 7671 7721 7770) is `any` that goes into
  //    parameters and members typed ResumableState | FormatContext | ..: no cast is needed, none is to be written.
  //    (NOTE: ONE resumableState goes through TWO such doors: createRenderState's and RequestInstance's. If a door COPIES a plain
  //    object into the layout they are two objects, and createRenderState's stores (instructions |= 32, scriptResources[src] = null) are lost.)
  // -------------------------------------------------------------------------------------------------------------------
  interface PostponedHoles { workingMap: Map<KeyNode, ReplayNode>; rootNodes: ReplayNode[]; rootSlots: ResumeSlots } // birth 3999 4109
  interface ReplaySet { nodes: ReplayNode[]; slots: ResumeSlots; pendingTasks: number } // birth 4066 5369 5460 5510 5622
  interface PostponedState { // birth 7318: handed to the user (StaticResult.postponed), kept in Request.postponedState
    nextSegmentId: SegmentId;
    rootFormatContext: FormatContext;
    progressiveChunkSize: number;
    resumableState: ResumableState;
    replayNodes: ReplayNode[];
    replaySlots: ResumeSlots;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 7. The DOM side: RenderState, ResumableState, FormatContext, resources
  // -------------------------------------------------------------------------------------------------------------------
  interface RenderState { // birth 297
    placeholderPrefix: PrecomputedChunk;
    segmentPrefix: PrecomputedChunk;
    boundaryPrefix: PrecomputedChunk;
    startInlineScript: PrecomputedChunk;
    startInlineStyle: PrecomputedChunk;
    preamble: PreambleState;
    externalRuntimeScript: null; // never stored again, never read
    bootstrapChunks: Chunk[];
    importMapChunks: Chunk[];
    onHeaders: OnHeaders | null | undefined; // given, or onHeadersImpl (7455 7605)
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
  type OnHeaders = (headers: PropsBag) => void; // is handed { Link } (6171) or {}
  interface PreloadHeaders { preconnects: string; fontPreloads: string; highImagePreloads: string; remainingCapacity: HeaderCapacity } // birth 289
  interface ResourceResets { font: ResourceDict; dns: ExistsDict; connect: ConnectResources; image: ResourceDict; style: ResourceDict } // birth 309
  interface PreloadMaps { // birth 326
    images: Map<string, Resource>;
    stylesheets: Map<string, Resource>;
    scripts: Map<string, Resource>;
    moduleScripts: Map<string, Resource>;
  }
  interface NoncePair { script: Nonce; style: Nonce } // birth 332
  /** ALSO GIVEN: resume* take it off the postponed state (section 6) */
  /** GIVEN AS WELL AS BORN: `resume(children, postponedState)` IS HANDED ONE THAT SOMEBODY ELSE HOLDS, AND React WRITES INTO IT (instructions, nextFormID, the resource tables). As a layout the given object was COPIED at the door and the writes went into the copy: the caller's object read instructions 112 where plain Bun's reads 114. A GIVEN OBJECT IS ADMITTED AS IT IS: SO IT IS `any` UNTIL THE ENGINE ADMITS A STRANGER AT A TYPED PLACE WITHOUT A COPY. What it holds, for the reader:
   *  idPrefix: string; // "" | options.identifierPrefix (given: React's type says string)
   *  nextFormID: int32;
   *  streamingFormat: int32; // 0, never read
   *  bootstrapScriptContent?: BootstrapScriptContent; // undefined once postponed (7297): AND THEN JSON DROPS IT: what `resume` is handed has 14 of these 17 members: OPTIONAL IS THE HONEST TYPE
   *  bootstrapScripts?: BootstrapScripts; // likewise
   *  bootstrapModules?: BootstrapScripts; // likewise
   *  instructions: InstructionState;
   *  hasBody: boolean;
   *  hasHtml: boolean;
   *  unknownResources: UnknownResourceDict;
   *  dnsResources: ExistsDict;
   *  connectResources: ConnectResources;
   *  imageResources: ResourceDict;
   *  styleResources: ResourceDict;
   *  scriptResources: ResourceDict;
   *  moduleUnknownResources: UnknownResourceDict;
   *  moduleScriptResources: ResourceDict;
   */
  type ResumableState = any;
  interface PreambleState { htmlChunks: Chunk[] | null; headChunks: Chunk[] | null; bodyChunks: Chunk[] | null } // birth 475
  /** ALSO GIVEN: postponedState.rootFormatContext (section 6) */
  interface FormatContext { // birth 483
    insertionMode: InsertionMode;
    selectedValue: SelectedValue; // null when none
    tagScope: TagScope;
    viewTransition: ViewTransitionContext | null;
  }
  interface ViewTransitionContext { // birth 555 4944
    update: ViewTransitionValue;
    enter: ViewTransitionValue;
    exit: ViewTransitionValue;
    share: ViewTransitionValue;
    parentEnter: string; // "none" at both births, never read
    parentExit: string; // "none" at both births, never read
    name: ViewTransitionValue;
    autoName: ViewTransitionValue;
    nameIdx: number;
  }
  interface HoistableState { styles: Set<StyleQueue>; stylesheets: Set<StylesheetResource>; suspenseyImages: boolean } // birth 2568
  interface StyleQueue { precedence: Chunk; rules: Chunk[]; hrefs: Chunk[]; sheets: Map<string, StylesheetResource> } // birth 1664 1816 2824
  interface StylesheetResource { state: StylesheetState; props: PropsBag } // birth 1671 2831: props is what assign() made

  // -------------------------------------------------------------------------------------------------------------------
  // 8. The stacks a task carries
  // -------------------------------------------------------------------------------------------------------------------
  interface ContextNode { // birth 5249. React's ContextSnapshot = ContextNode | null
    parent: ContextNode | null;
    depth: ContextDepth;
    context: ReactContext;
    parentValue: ContextValue;
    value: ContextValue;
  }
  interface ComponentStackNode { parent: ComponentStackNode | null; type: ElementType } // birth 4297 4305 (type "Suspense Fallback")
  interface TreeContext { id: TreeId; overflow: string } // birth 3119 3140 3148

  // -------------------------------------------------------------------------------------------------------------------
  // 9. Hooks, the tables of functions handed to react and react-dom, classes
  // -------------------------------------------------------------------------------------------------------------------
  interface Hook { memoizedState: HookState; queue: UpdateQueue | null; next: Hook | null } // birth 3291
  interface UpdateQueue { last: Update | null; dispatch: Dispatch | null } // birth 3352: last is never stored again, never read
  interface Update { action: HookState; next: Update | null } // birth 3392
  interface RefObject { current: any } // birth 3507: handed to the user, kept in Hook.memoizedState
  type Dispatch = (action: any) => void;
  type Reducer = (state: any, action: any) => any;
  /** births 3438 3468: a function; 3442 stores a member on the first */
  interface ActionDispatch { (payload: any): void; $$FORM_ACTION?: (prefix: any) => CustomFormFields }
  /** var HooksDispatcher: FZ.Dispatcher = { .. }: the function expressions in it then need no annotation. react reads it by name off SharedInternals.H */
  interface Dispatcher { // birth 3483
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
  interface AsyncDispatcher { getCacheForType(resourceType?: GivenFunction): any; cacheSignal(): any } // birth 3572: both throw
  interface FormStatusNotPending { pending: boolean; data: null; method: null; action: null } // birth 219: handed to the user
  /** stored by name to DOMSharedInternals.d: react-dom reads it by name */
  interface HostDispatcher { // birth 226
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
  interface ClassComponentUpdater { // birth 3107
    enqueueSetState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueReplaceState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueForceUpdate(inst?: ClassInstance, callback?: any): void;
  }
  interface InternalInstance { queue: any[] | null; replace: boolean } // birth 4610: stored by name to ClassInstance._reactInternals, comes back as any (3109 3113)

  // -------------------------------------------------------------------------------------------------------------------
  // 10. Small things, and what is handed to the user
  // -------------------------------------------------------------------------------------------------------------------
  /** BORN EMPTY: {}. The one member says: there is no member: so that no other shape is assignable to it. Made for every function component rendered; compared by === (dispatchAction) */
  interface ComponentIdentity { readonly $$fzIdentity?: never } // birth 4525
  /** BORN EMPTY: {}. emptyContextObject: handed to the user's classes as their context */
  interface EmptyContext { readonly $$fzEmptyContext?: never } // birth 3039
  interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } } // birth 3605 (not in births.txt)
  /** goes into Destination (any) and is read by name there */
  interface FakeWritable { write(chunk: any): any; end(): void; destroy(error: Thrown): void } // birth 7383 7421 7438
  interface StaticResult { postponed: PostponedState | null; prelude: WebReadableStream } // birth 7499 7541 7749 7786: handed to resolve(); at 7541 7786 prelude is a NodeReadable: any both
  interface PipeableStream { pipe(destination: Destination): Destination; abort(reason?: Thrown): void } // birth 7559 7801: the exported function's result
}

// ---------------------------------------------------------------------------------------------------------------------
// Globals the bundle names and the checker's library (ES only) lacks. Delete this block when a real library is in.
// ---------------------------------------------------------------------------------------------------------------------
declare var require: (name: string) => any;
declare var exports: any;
declare var console: { error(...data: any[]): void };
declare var Buffer: { byteLength(chunk: string, encoding: string): number };
declare var Bun: { hash(data: string): number | bigint };
declare var AbortController: new () => FZ.AbortControllerGiven;
declare var ReadableStream: new (source: any, strategy?: any) => FZ.WebReadableStream;
declare var Headers: new (init?: any) => any;
declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function queueMicrotask(callback: () => void): void;

// ---------------------------------------------------------------------------------------------------------------------
// A. THE MODULE-LEVEL VARIABLES (95 declarators in 33 statements). Not listed = a constant symbol | regular expression |
//    string: leave it to inference (the 20 REACT_*, MAYBE_ITERATOR_SYMBOL, the 12 patterns, actionJavaScriptURL: 34). The other 61:
// ---------------------------------------------------------------------------------------------------------------------
//   12 React                                       FZ.ReactModule
//   13 ReactDOM                                    FZ.ReactDOMModule
//   14 util                                        FZ.UtilModule
//   16 stream                                      FZ.StreamModule        (locals named stream shadow it: 7482 7632 7683 7732)
//   44 isArrayImpl                                 inference (Array.isArray: a type guard to any[])
//   45 scheduleMicrotask                           inference
//   62 assign                                      FZ.Assign
//   63 hasOwnProperty                              inference
//   67 illegalAttributeNameCache                   FZ.NameCache
//   68 validatedAttributeNameCache                 FZ.NameCache
//   78 unitlessNumbers                             Set<string>            (inference gives it)
//   83 aliases                                     Map<string, string>    (inference gives it)
//  215 ReactSharedInternals                        FZ.SharedInternals
//  217 ReactDOMSharedInternals                     FZ.DOMSharedInternals
//  219 sharedNotPendingObject                      FZ.FormStatusNotPending
//  225 previousDispatcher                          FZ.HostDispatcherGiven
//  226 ReactDOMSharedInternals.d = { .. }          no variable: the literal goes into any: = { .. }/*$*/ as FZ.HostDispatcher/*$*/;
//  237 PRELOAD_NO_CREDS                            FZ.PreloadState
//  238 currentlyFlushingRenderState                FZ.RenderState | null
//  623 styleNameCache                              Map<string, FZ.Chunk>
// 1110 validatedTagCache                           Map<string, FZ.Chunk>
// 2185 endTagCache                                 Map<string, FZ.Chunk>
// 2352 currentlyRenderingBoundaryHasStylesToHoist  boolean
// 2353 destinationHasCapacity                      boolean
// 2393 stylesheetFlushingQueue                     FZ.Chunk[]
// 2983 bind                                        inference
// 3039 emptyContextObject                          FZ.EmptyContext
// 3040 currentActiveSnapshot                       FZ.ContextNode | null
// 3107 classComponentUpdater                       FZ.ClassComponentUpdater
// 3119 emptyTreeContext                            FZ.TreeContext
// 3153 clz32                                       (x: number) => number
// 3154 log · 3155 LN2                              inference
// 3161 SuspenseException                           inference (Error)
// 3210 suspendedThenable                           FZ.Thenable            (null when none)
// 3223 objectIs                                    (x: any, y: any) => boolean
// 3224 currentlyRenderingComponent                 FZ.ComponentIdentity | null
// 3225 currentlyRenderingTask                      FZ.Task | null
// 3226 currentlyRenderingRequest                   FZ.Request | null
// 3227 currentlyRenderingKeyPath                   FZ.KeyNode | null
// 3228 firstWorkInProgressHook                     FZ.Hook | null
// 3229 workInProgressHook                          FZ.Hook | null
// 3230 isReRender · 3231 didScheduleRenderPhaseUpdate   boolean
// 3232 localIdCounter · 3233 actionStateCounter · 3234 actionStateMatchingIndex · 3235 thenableIndexCounter   FZ.HookCounter
// 3236 thenableState                               FZ.ThenableState | null
// 3279 renderPhaseUpdates                          Map<FZ.UpdateQueue, FZ.Update> | null
// 3280 numberOfReRenders                           FZ.HookCounter
// 3483 HooksDispatcher                             FZ.Dispatcher
// 3571 currentResumableState                       FZ.ResumableState | null
// 3572 DefaultAsyncDispatcher                      FZ.AsyncDispatcher
// 3580 prefix · 3581 suffix                        string | undefined
// 3598 reentry                                     boolean
// 4116 currentRequest                              FZ.Request | null
// 6687 flushedByteSize                             FZ.ByteSize
// 6888 flushingPartialBoundaries · 6889 flushingShell   boolean
// 7339 textEncoder                                 FZ.TextEncoderGiven

// ---------------------------------------------------------------------------------------------------------------------
// B. A PARAMETER'S NAME SAYS ITS TYPE, in all 193 functions, so that the 13 pieces agree. THE TYPE THAT ARRIVES (rule 4a's name$given).
// ---------------------------------------------------------------------------------------------------------------------
// request request$jscomp$0 request$jscomp$1   FZ.Request
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
// abortSet fallbackAbortableTasks abortableTasks   Set<FZ.Task>
// preamble (createSuspenseBoundary)           FZ.BoundaryPreamble | null
// keyPath                                     FZ.KeyNode             (createRenderTask createReplayTask: | null) · parentKeyPath: FZ.KeyNode | null
// context                                     FZ.ContextNode | null  (getTreeId: FZ.TreeContext)
// prev next · newSnapshot                     FZ.ContextNode · FZ.ContextNode | null
// treeContext baseContext                     FZ.TreeContext
// componentStack node$jscomp$0 (getThrownInfo)   FZ.ComponentStackNode | null
// thenableState                               FZ.ThenableState | null   (trackUsedThenable: never null)
// replay · nodes · slots                      FZ.ReplaySet · FZ.ReplayNode[] · FZ.ResumeSlots
// trackedPostpones                            FZ.PostponedHoles
// node                                        FZ.ReactNode           (addToReplayParent: FZ.ReplayNode)
// children                                    FZ.ReactNode           (renderChildrenArray: FZ.ReactNode[]) · rows: FZ.ReactNode (NOT an array type: 4873 hands over the iterable itself)
// props · type · ref                          FZ.Props · FZ.ElementType (string: getChildFormatContext pushStartInstance) · FZ.Ref
// Component · secondArg · fn                  FZ.FunctionComponent · any · FZ.ElementType
// styleQueue · stylesheet · resource          FZ.StyleQueue · FZ.StylesheetResource · FZ.Resource
// collectedPreambleSegments                   FZ.Segment[][]
// errorInfo · errorDigest$jscomp$0            FZ.ThrownInfo · FZ.ErrorDigest
// error reason recoverableError               FZ.Thrown              (createCancelHandler's reason: string) · recoverable: FZ.Recoverable
// thenable                                    FZ.Thenable
// options · postponedState                    FZ.Options · FZ.PostponedStateGiven
// value style innerHTML href as src crossOrigin precedence formEncType formMethod formTarget revealOrder defaultClass eventClass
//   text url input permalink initialState initialArg state action maybeIterable params key   FZ.PropValue or the nearer GIVEN alias: all any
// formAction · nonce · importMap · selectedValue · formState   FZ.FormAction · FZ.Nonce · FZ.ImportMap · FZ.SelectedValue · FZ.ReactFormState
// identifierPrefix externalRuntimeConfig bootstrapScriptContent bootstrapScripts bootstrapModules maxHeadersLength namespaceURI   FZ.PropValue (off the options)
// progressiveChunkSize onError onBrowserBailout onAllReady onShellReady onShellError onFatalError   as in FZ.RequestConstructor · onHeaders: FZ.OnHeaders | null | undefined
// name tag attributeName treeId match prefix s suffix   string   (FZ.PropValue: pushFormActionAttribute's and describeBuiltInComponentFrame's name)
// chunk                                       FZ.Chunk
// childIndex                                  FZ.ChildIndex
// id segmentId                                FZ.SegmentId
// index localId totalChildren actionStateCount actionStateMatchingIndex   FZ.int32 · insertionMode: FZ.InsertionMode · tagScope: FZ.TagScope
// textEmbedded lastPushedText hasId defer construct shellComplete flushingInShell   boolean
// viewTransition parentViewTransition         FZ.ViewTransitionContext | null
// preloadState                                FZ.PreloadState
// reducer · init · nextCreate · deps          FZ.Reducer · ((initialArg: any) => any) | undefined · () => any · FZ.HookDeps
// componentIdentity · queue                   FZ.ComponentIdentity · FZ.UpdateQueue
// controller · readable · signal              FZ.StreamController · FZ.NodeReadable · FZ.AbortSignalGiven
// x y                                         number (clz32Fallback) · any (is)
// `this`: FZ.Chunk[] pushAdditionalFormField · FZ.Destination flushStyleTagsLateForBoundary flushResource flushStyleInPreamble flushStylesInPreamble
//   preloadLateStyle preloadLateStyles · FZ.HoistableState hoistStyleQueueDependency hoistStylesheetDependency · FZ.Request abortTaskSoft RequestInstance

// ---------------------------------------------------------------------------------------------------------------------
// C. RESULTS that callers in other pieces lean on. Not listed = void, or plain to inference.
// ---------------------------------------------------------------------------------------------------------------------
// string: escapeTextForBrowser makeId scriptReplacer styleReplacer escapeJS*ForInstructionScripts getPreloadAsHeader getTreeId the two escape*Replacer
//   describeBuiltInComponentFrame describeNativeComponentFrame describeComponentStackByType · FZ.ComponentName: getComponentNameFromType
// FZ.Chunk: startChunkForTag endChunkForTag · number: byteLengthOfChunk clz32Fallback
// boolean: isAttributeNameSafe pushTextInstance writeBootstrap writeStartPendingSuspenseBoundary writeStartSegment writeEndSegment hasStylesToHoist
//   writeHoistablesForBoundary hasSuspenseyContent is isRecoverableError isEligibleForOutlining preparePreambleFromSubtree preparePreambleFromSegment
//   flushSubtree flushSegment flushSegmentContainer flushCompletedBoundary flushPartiallyCompletedSegment
// null: pushLinkImpl pushSelfClosing pushTitleImpl pushScriptImpl defaultErrorHandler
// FZ.ReactNode: pushStartSingletonElement pushStartGenericElement pushStartInstance renderWithHooks · any: trackUsedThenable unwrapThenable basicStateReducer useMemo
// sanitizeURL<T>(url: T): T | string · getIteratorFn: FZ.IteratorFn · getViewTransitionClassName: FZ.ViewTransitionValue
// getCustomFormFields: FZ.CustomFormFields · pushFormActionAttribute: FZ.FormDataGiven · flattenOptionChildren: string
// createRenderState: FZ.RenderState · createResumableState: FZ.ResumableState · createPreambleState: FZ.PreambleState · createHoistableState: FZ.HoistableState
// createFormatContext createRootFormatContext getChildFormatContext getSuspenseFallbackFormatContext getSuspenseContentFormatContext: FZ.FormatContext
// getSuspenseViewTransition: FZ.ViewTransitionContext | null · pushTreeContext: FZ.TreeContext
// getSuspendedThenable: FZ.Thenable · getThenableStateAfterSuspending: FZ.ThenableState | null · resolveCurrentlyRenderingComponent: FZ.ComponentIdentity
// createHook createWorkInProgressHook: FZ.Hook · useReducer: FZ.DispatchTuple · useActionState: FZ.ActionStateTuple
// createRecoverableError cloneRecoverableErrorAsFatal: Error
// createRequest createPrerenderRequest resumeRequest resumeAndPrerenderRequest createRequestImpl resumeRequestImpl: FZ.Request
// createSuspenseBoundary: FZ.SuspenseBoundary · createRenderTask createReplayTask spawnNewSuspendedReplayTask spawnNewSuspendedRenderTask: FZ.Task
// createPendingSegment: FZ.Segment · createSuspenseListRow: FZ.SuspenseListRow
// replaceSuspenseComponentStackWithSuspenseFallbackStack: FZ.ComponentStackNode | null · getThrownInfo: FZ.ThrownInfo · logRecoverableError: FZ.ErrorDigest
// trackPostponedBoundary: FZ.ReplayNode · getPostponedState: FZ.PostponedState | null
// createDrainHandler createCancelHandler: () => void · the three createFakeWritable*: FZ.FakeWritable
// renderNode renderNodeDestructive retryNode: void (they `return` the void of one another)

// ---------------------------------------------------------------------------------------------------------------------
// D. BIRTHS LEFT WITHOUT AN INTERFACE, ON PURPOSE: literals handed straight to a built-in, to given code, or to a for..in of ours, never stored to again.
// ---------------------------------------------------------------------------------------------------------------------
// 3249 3265 { cause } -> Error · 3251 3679 4326 { value } 3612 { set } 3636 { configurable, set } 4310 { configurable, enumerable, get } -> Object.defineProperty
// 6171 { Link } | {} -> onHeaders · 7238 { signal } -> addEventListener · 7483 7633 7684 7733 { type, start?, pull, cancel } 7497 7643 7700 7747 { highWaterMark }
//   -> ReadableStream · 7535 7780 { read } -> stream.Readable
// 2011 6150 -> getPreloadAsHeader's params (for..in) · 2026 2433 2598 2648 -> pushLinkImpl's props (for..in) · 1673 { data-precedence, precedence } -> a source of assign()
// 6813 6833 { g }: NO BIRTH: text inside a string.
// DICTIONARIES, NOT LAYOUTS (section 3): 340 395 and the first arguments of assign (1673 1743 2693 2707 2725 2759 2804 2834 2861 2887 4588 4627 4686): FZ.PropsBag ·
//   312 466 { default, anonymous, credentials }: FZ.ConnectResources · 7308 { font }: FZ.UnknownResourceDict

// ---------------------------------------------------------------------------------------------------------------------
// E. THE VARIABLES THAT HOLD TWO OR MORE KINDS OF OBJECT, found by program. p = a parameter (rule 4a) · l = a local (rule 4c: a marked variable a role).
//    `a > b` = holds a, later b. given = any. What is not listed holds one kind of object at most, beside numbers | strings | booleans | null | undefined.
//    A variable that STARTS as any (var key = node.key) stays any for the checker: a born literal stored to it is checked against nothing: split that role off too.
// ---------------------------------------------------------------------------------------------------------------------
// createRenderState (once a request: cold)   p importMap given > PreloadHeaders | null > int32 > string | undefined · p onHeaders OnHeaders > RenderState · p nonce given > int32
//   p maxHeadersLength given > string | undefined · l idPrefix string > given > ResumableState > Resource · l nonceStyle given > string | undefined > given > ResumableState > Resource
//   l inlineStyleWithNonce string > PropsBag (340) > string · l inlineScriptWithNonce string > string | undefined > PropsBag (395) · l bootstrapScriptContent given > Chunk[] > string
// getSuspenseContentFormatContext p resumableState > ViewTransitionContext | null · pushViewTransitionAttributes p formatContext > ViewTransitionContext | null
// hoistPreambleState p renderState > PreambleState · writeBootstrap p renderState > Chunk[], l i int32 > Chunk · flushStylesInPreamble p styleQueue > int32 · preloadLateStyle p stylesheet > int32
// prefetchDNS preconnect preload   l resumableState ResumableState > PreloadHeaders | null (> Resource in preload) · l header string > Resource (prefetchDNS)
//   l bucket ConnectBucket > Resource (preconnect) · l imageSrcSet given > Resource > ResourceDict (preload) · p href given > PropsBag (2759)
// preloadModule l as string > Resource · preinitStyle p precedence given > StylesheetResource (2831), l renderState RenderState > Resource | undefined
// preinitScript preinitModuleScript   p src given > Resource | undefined > Resource · p options given > PropsBag
// useReducer p reducer Reducer > state > UpdateQueue (3352) > Dispatch · p initialArg given > Dispatch | null · p init > Update | undefined | null · l queue UpdateQueue | null > state
// dispatchAction p componentIdentity ComponentIdentity > Update (3392) · p action given > Update | undefined · p queue UpdateQueue > Update
// HooksDispatcher.useRef initialValue given > RefObject (3507) · useActionState p action given > ActionDispatch (3438), l request Request | null > ReactFormState
// describeNativeComponentFrame l RunInRootFrame > int32 · l namePropDescriptor PropertyDescriptor | undefined > int32 · l Fake a function > boolean > given
// createRequest p resumableState > Request · p renderState > Segment · p children > Task · createPrerenderRequest resumeAndPrerenderRequest p children > Request
// resumeRequest p renderState > Request · p onError > Segment · p children > Task
// createSuspenseBoundary p fallbackAbortableTasks Set<Task> > SuspenseBoundary (4136) · p preamble BoundaryPreamble | null > SuspenseBoundary[] | null · p request > HoistableState | null
// logRecoverableError p request > BailoutHandler | ErrorHandler, p error > the handler's result · completeShell completeAll p request > () => void · endRenderLifetime p request > AbortControllerGiven
// renderSuspenseListRows p keyPath KeyNode > int32 · p revealOrder given > int32 · l resumeSlots ResumeSlots > int32 > ReactNode > Segment | null · l n i node resumeSegmentID: int32 and ReactNode by turns
// renderWithHooks p request > ReactNode · finishFunctionComponent p keyPath KeyNode > TreeContext · p actionStateCount int32 > KeyNode | null · l segment Segment | null > Chunk[]
// renderNodeDestructive p node given > ComponentStackNode | null
// retryNode (EVERY ELEMENT)   l key given > KeyNode (5349: on the path of every element: its own variable) > ThrownInfo > ErrorDigest · l childIndex int32 > ReplayNode[] > string > Segment | null
//   l node given > int32 > given · l type given > ReplayNode[] · l props given > SuspenseBoundary | null > given · l ref given > ResumeSlots · l name given > ReplayNode[] · l keyOrIndex given > KeyNode | null
//   l replay ReplaySet > SegmentId · l node$jscomp$0 ReplayNode > ResumeSlots · l childNodes ReplayNode[] > Thrown > Task > given · l childSlots ResumeSlots > ThrownInfo > ReactNode[]
//   l currentNode given > Request > ErrorDigest · p request > Thrown
// renderChildrenArray (EVERY ARRAY)   l replay ReplaySet > TreeContext · l replayNodes ReplayNode[] > int32 · l j int32 > ResumeSlots > int32 · l node ReplayNode > ResumeSlots > given
//   p childIndex int32 > ReplayNode[] > int32 > given · p children > Request · p request > Thrown · l thrownInfo ThrownInfo > ErrorDigest · l boundary SuspenseBoundary | null > SegmentId | undefined
// trackPostponedBoundary p request > KeyNode | null · p boundary > ReplayNode (5703) · l tracked TrackedBoundary | null > ReplayNode | null
// trackPostpone p request > ResumeSlots · p task > ReplayNode | undefined · l boundary SuspenseBoundary | null > Map<KeyNode, ReplayNode>
// untrackBoundary p request > PostponedHoles | null > ReplayNode | undefined · p boundary > TrackedBoundary | null > KeyNode | null
// renderNode (EVERY NODE)   l segment Segment | null > ReplaySet | null > Thenable > ThenableState | null > Task · p node given > ThenableState | null > Task · p request > Ping · p childIndex int32 > ThenableState | null
// abortRemainingReplayNodes l node ReplayNode > SegmentId · abortTask p task > Segment | null
// finishAbortedTask p task > Error > SuspenseListRow | null · l boundary SuspenseBoundary | null > ReplaySet | null > PostponedHoles · l errorInfo ThrownInfo > ErrorDigest > SuspenseListRow | null
// finishedSegment p segment > Chunk[] · trackUsedThenable p thenableState ThenableState > Thrown > Thenable, p index int32 > Thenable | undefined
// finishedTask p boundary > SuspenseListRow | null · p row > PostponedHoles · p segment > SuspenseBoundary[] | null · l postponedRow SuspenseListRow | null > int32
// performWork l request$jscomp$0 Request > Segment > Request (declared in one branch at 6361, used in the other from 6422)
// flushSubtree p request > RenderState > string · p segment > Segment[] · p hoistableState > SegmentId · l r boolean > Segment > boolean
// flushSegment p segment > SuspenseListRow | null > Segment[] · l boundary SuspenseBoundary | null > ErrorDigest
// flushCompletedBoundary p request > RenderState · p boundary > HoistableState > boolean · l completedSegments Segment[] > SuspenseListRow | null > ResumableState > string · l i int32 > SegmentId
// flushPartiallyCompletedSegment p request > RenderState · p boundary > ResumableState · p destination > boolean · l segmentID SegmentId > string
// flushCompletedQueues l i int32 > PostponedState | null > ResumableState · l clientRenderedBoundaries SuspenseBoundary[] > Request · l boundary SuspenseBoundary > Destination
//   l renderState$jscomp$1 RenderState > Destination · l resumableState, renderState, completedRootSegment, completedPreambleSegments: their shape > int32 · l JSCompiler_inline_result boolean > int32
// startFlowing p request > Thrown · getPostponedState l trackedPostpones PostponedHoles | null > PostponedState (7318)
// exports.prerender resumeAndPrerender l stream WebReadableStream > StaticResult · exports.prerenderToNodeStream resumeAndPrerenderToNodeStream l readable NodeReadable > StaticResult

// ---------------------------------------------------------------------------------------------------------------------
// F. IDIOMS, probed on the checker
// ---------------------------------------------------------------------------------------------------------------------
// catch (x: FZ.Thrown) · new Set<FZ.Task>() (3885 5009 5437; 5992 takes it from the parameter) · new Map<FZ.KeyNode, FZ.ReplayNode>() comes by itself where the literal around it is typed
// an array literal becomes a tuple only against its type: var fallbackKeyPath: FZ.KeyNode = [..] · var fallbackReplayNode: FZ.ReplayNode = [..]
// dict.hasOwnProperty(key) is Object's own method, not the index signature · delete slots[i] and for (var index in slots) pass on FZ.SlotMap · slots[i] reads as SegmentId | undefined BY THE ALIAS: no cast; "number" === typeof narrows both branches (the other dictionaries are only read behind hasOwnProperty: their values carry no undefined)
// var bucket: FZ.ConnectBucket | FZ.Resource · request.length = 4 passes on FZ.ReplayNode (5799)
// pushAllNext(newSnapshot!) (3097): TS2345: `bang` does not put that one · task.replay! task.blockedSegment! wherever React knows which kind of task it holds
