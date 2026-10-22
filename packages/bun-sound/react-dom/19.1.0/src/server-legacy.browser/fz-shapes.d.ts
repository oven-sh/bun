// fz-shapes.d.ts: the shapes of react-dom 19.1.0, cjs/react-dom-server-legacy.browser.production.js (Fizz, the legacy bundle). READ OFF THE BUNDLE'S OWN BIRTHS
// (carried over from 19.2.8's shapes; where this version's birth has other members the interface is THIS version's, and says "19.1.0"):
// the members of an interface stand in the order in which the birth STORES them (a chain this.a = this.b = 0 stores b first).
// "birth NNNN" = line of original.js. "given" = the value is made elsewhere (react, react-dom, Bun, Node, the user).
// CHECKED BY PROGRAM (python3 shapes_check.py): the 39 births named behind the heads have their interface's members, in its order; no two births of one interface differ. births.txt (python3 births.py): every birth of this bundle.
// THE CHECKER DOES NOT LOOK INTO A .d.ts (it says "0 files"; a name that does not exist there is silently any): python3 shapes_check.py checks all fz-shapes*.d.ts as .ts, and the births again.
// WHAT 19.2.8 HAS AND THIS VERSION HAS NOT: SuspenseListRow (Task.row, SuspenseBoundary.row: <SuspenseList> is rendered as a fragment here), ViewTransitionContext (FormatContext.viewTransition),
//   NoncePair (RenderState.nonce), RenderState.startInlineStyle, HoistableState.suspenseyImages, Request.byteSize, Dispatcher.useEffectEvent, AsyncDispatcher.cacheSignal,
//   trackPostpone (so: no birth of a SlotMap, none of a 6-long ReplayNode), the "Suspense Fallback" ComponentStackNode, the bits of TagScope above 2 and of InstructionState above 16.
// WHAT THIS VERSION HAS AND 19.2.8 HAS NOT: Task.isFallback, PreambleState.contribution, createPreambleState (boundaries DO get preambles here: 4127 4481).
declare namespace FZ {
  // -------------------------------------------------------------------------------------------------------------------
  // 1. Numbers. int32: four bytes and integer arithmetic; the build proves every value that is stored there, or stops.
  // -------------------------------------------------------------------------------------------------------------------
  type int32 = import("bun").int32;
  type RequestStatus = int32; // Request.status: 10 OPENING 11 OPEN 12 ABORTING 13 CLOSING 14 CLOSED
  type SegmentStatus = int32; // Segment.status: 0 PENDING 1 COMPLETED 2 FLUSHED 3 ABORTED 4 ERRORED 5 POSTPONED (tested, never stored) 6 RENDERING
  type BoundaryStatus = int32; // SuspenseBoundary.status: 0 PENDING 1 COMPLETED 4 CLIENT_RENDERED 5 POSTPONED (tested, never stored)
  type StylesheetState = int32; // StylesheetResource.state: 0 PENDING 1 PRELOADED 2 PREAMBLE 3 LATE
  type InsertionMode = int32; // 0 ROOT_HTML 1 HTML_HTML 2 HTML 3 HTML_HEAD 4 SVG 5 MATHML 6 TABLE 7 TABLE_BODY 8 TABLE_ROW 9 COLGROUP
  type TagScope = int32; // bits, 19.1.0: 1 NOSCRIPT 2 PICTURE: no others
  type PreambleContribution = int32; // 19.1.0: PreambleState.contribution: bits: 1 html 2 body 4 head (1867 1875 1871); written out as a digit (1894)
  type InstructionState = int32; // bits, 19.1.0: 1 $RS 2 $RC 4 $RX 8 $RR 16 form replay: no others
  type SegmentId = int32; // Segment.id, SuspenseBoundary.rootSegmentID, Request.nextSegmentId: -1 = none yet
  type ChildIndex = int32; // Task.childIndex: -1 = not a child of an array
  type TaskCount = int32; // every pendingTasks | allPendingTasks | pendingRootTasks
  type ChunkIndex = int32; // Segment.index, a length of chunks | children
  type TreeId = int32; // TreeContext.id: made by << | & alone
  type ContextDepth = int32;
  type HookCounter = int32; // localIdCounter actionStateCounter actionStateMatchingIndex (-1) thenableIndexCounter numberOfReRenders
  type ByteSize = number; // sums of chunks' lengths by React's model: NOT int32. 19.1.0's legacy bundle: SuspenseBoundary.byteSize alone: born 0 (3642), never stored again, compared with progressiveChunkSize (5423)
  type HeaderCapacity = number; // PreloadHeaders.remainingCapacity: NOT int32: the user's number

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
  type IteratorFn = any; // 19.1.0: no getIteratorFn: retryNode reads node[Symbol.iterator] || node["@@iterator"] itself (4577): that function (null when none), and the iterator and steps it gives
  type Destination = any; // renderToStringImpl's { push, destroy } (5862): read by name. null when none
  type Options = any; // the bag an exported function is handed; the bag of preload | preloadModule | preinit*
  type ReactFormState = any; // options.formState: [state, keyPath, referenceId, boundArgumentCount]. null when none
  type FormAction = any; // a server action: $$FORM_ACTION $$IS_SIGNATURE_EQUAL bind
  type CustomFormFields = any; // what $$FORM_ACTION gives: name action encType method target data. null when none
  type FormDataGiven = any; // null when none
  type SelectedValue = any; // <select>'s value | defaultValue. null when none
  type BootstrapScriptContent = any; // options.bootstrapScriptContent: string | undefined
  type BootstrapScripts = any; // options.bootstrapScripts | bootstrapModules: Array<string | { src, integrity, crossOrigin }> | undefined
  type ReactModule = any; // require("react"): Children version __CLIENT_INTERNALS..
  type ReactDOMModule = any; // require("react-dom")
  type SharedInternals = any; // react's { H, A, T, S .. }: H and A are stored by name (performWork)
  type DOMSharedInternals = any; // react-dom's { d, p, findDOMNode }: d is stored by name (289)
  type HostDispatcherGiven = any; // previousDispatcher: react-dom's own { f r D C L m X S M }
  type GivenFunction = any;

  // -------------------------------------------------------------------------------------------------------------------
  // 3. Chunks, dictionaries, tuples
  // -------------------------------------------------------------------------------------------------------------------
  type Chunk = string; // the legacy bundle has no stringToChunk: a chunk IS the string: destination.push(chunk)
  type PrecomputedChunk = string; // no stringToPrecomputedChunk either
  type Resource = Chunk[]; // a <link> | <script> as chunks; emptied by .length = 0 when flushed or adopted

  // DICTIONARIES: born {} (or by Object.assign, or by JSON.parse) and read by a computed name: plain objects, no layout.
  type PropsBag = { [name: string]: any }; // props MADE here: {} 3872 4274 · 2671 2715 (members are ADDED behind the birth) · every first argument and result of assign()
  type Assign = (target: PropsBag, ...sources: any[]) => PropsBag; // var assign: so that its literal first arguments are checked as dictionaries
  type NameCache = { [name: string]: boolean }; // births 131 132
  type PreloadState = PropValue[]; // [] (PRELOAD_NO_CREDS 300, one array, compared by .length) | [crossOrigin, integrity] births 2377 2395 2454 5010
  type ResourceDict = { [key: string]: PreloadState | null }; // null = Exists. births 325..327 329 2405 2462 2762 2765 2766
  type ExistsDict = { [key: string]: null }; // births 323 324 2763 2764
  type UnknownResourceDict = { [as: string]: ResourceDict }; // births 322 328
  type ConnectBucket = "default" | "anonymous" | "credentials";
  type ConnectResources = { [bucket: string]: ExistsDict }; // births 324 2764: { default, anonymous, credentials }: only ever read as [bucket]
  type SlotMap = { [index: string]: SegmentId | undefined }; // NO BIRTH in this bundle (19.1.0: no trackPostpone). READ FOR EVERY CHILD INDEX, also those without a slot, and told apart by "number" === typeof (4692 4693): undefined = absent; members are deleted as they are resumed (4695) or aborted (4910)
  type ThrownInfo = { [name: string]: unknown }; // births 3772 5019 5254 5800 5826: {}; componentStack is an ACCESSOR put by Object.defineProperty. Only handed to onError

  // TUPLES: arrays the bundle builds; JSON.stringify sees the first (useActionState) and the second (the postponed state).
  type KeyNode = [parent: KeyNode | null, name: ComponentName, keyOrIndex: KeyOrIndex]; // births 4153 4257 4396 4543 4636
  /**
   * birth 4154 (4 long); NO BIRTH of a 6 long one in this bundle. ONE TYPE all the same: the text reads node[4] node[5] (4462..4468 4885) and makes a 6 into a 4 by .length = 4 (4715).
   * 4 === node.length tells them apart but does not narrow: node[4]! node[5]! in the other branch.
   */
  type ReplayNode = [name: ComponentName, keyOrIndex: KeyOrIndex, children: ReplayNode[], slots: ResumeSlots, fallback?: ReplayNode | null, rootSegmentID?: SegmentId];
  type ResumeSlots = SlotMap | SegmentId | null; // null nothing · a number: resume at the root position · a map: child index -> segment id
  type ThenableState = Thenable[]; // birth 3211
  type MemoState = [value: any, deps: HookDeps]; // birth 3121, in Hook.memoizedState
  type DispatchTuple = [state: HookState, dispatch: Dispatch | null]; // births 3079 3081 3098
  type OptimisticTuple = [state: HookState, dispatch: Dispatch]; // birth 3290
  type TransitionTuple = [isPending: boolean, start: (callback?: GivenFunction) => void]; // birth 3264
  type ActionStateTuple = [state: HookState, dispatch: ActionDispatch, isPending: boolean]; // births 3197 3200
  type ComponentFrameSample = [sample: string | null, control: string | null]; // births 3377 3379

  // -------------------------------------------------------------------------------------------------------------------
  // 4. Request
  // -------------------------------------------------------------------------------------------------------------------
  interface Request { // birth 3527 RequestInstance
    destination: Destination; // null when none
    flushScheduled: boolean;
    resumableState: ResumableState;
    renderState: RenderState;
    rootFormatContext: FormatContext;
    progressiveChunkSize: number; // 12800 | what is handed over: Infinity at the one call of the legacy bundle (5846): NOT int32
    status: RequestStatus;
    fatalError: Thrown; // null until fatalError() | abort()
    nextSegmentId: number;
    allPendingTasks: number;
    pendingRootTasks: number;
    completedRootSegment: Segment | null;
    completedPreambleSegments: Segment[][] | null;
    abortableTasks: Set<Task>;
    pingedTasks: Task[];
    clientRenderedBoundaries: SuspenseBoundary[];
    completedBoundaries: SuspenseBoundary[];
    partialBoundaries: SuspenseBoundary[];
    trackedPostpones: PostponedHoles | null; // null always in the legacy bundle: never stored again
    onError: ErrorHandler;
    onPostpone: PostponeHandler; // never called in this bundle
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
  // PostponeHandler (Request.onPostpone: the user's, or noop) stands in fz-shapes-05.d.ts: ONE declaration
  type ErrorDigest = string | null | undefined; // logRecoverableError's result

  // -------------------------------------------------------------------------------------------------------------------
  // 5. Task, Segment, SuspenseBoundary (19.1.0: no SuspenseListRow)
  // -------------------------------------------------------------------------------------------------------------------
  /** React's RenderTask (3674: replay null, blockedSegment a Segment) and ReplayTask (3718: replay a ReplaySet, blockedSegment null): THE SAME MEMBERS IN THE SAME ORDER, and resumeNode (4344) turns one into the other and back: ONE SHAPE */
  interface Task { // birth 3674 3718
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
    componentStack: ComponentStackNode | null;
    thenableState: ThenableState | null;
    isFallback: boolean; // 19.1.0: LAST. the task renders a Suspense fallback: false at the root (3617), true at 4262 4548, else the parent task's; handed on to pushStartInstance (3994)
  }
  type Ping = () => void; // a FUNCTION (3678 3722), no record: handed to thenable.then(ping, ping)
  interface Segment { // birth 3749
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
  interface SuspenseBoundary { // birth 3636
    status: BoundaryStatus;
    rootSegmentID: number;
    parentFlushed: boolean;
    pendingTasks: number;
    completedSegments: Segment[];
    byteSize: ByteSize;
    fallbackAbortableTasks: Set<Task>;
    errorDigest: ErrorDigest;
    contentState: HoistableState;
    fallbackState: HoistableState;
    contentPreamble: PreambleState | null; // these four members stand in the boundary itself: no BoundaryPreamble, no TrackedBoundary. 19.1.0: createPreambleState() where the boundary stands above <body> (4127 4481), else null (4130 4487 4891: three calls)
    fallbackPreamble: PreambleState | null; // likewise
    trackedContentKeyPath: KeyNode | null; // born null; stored 4132
    trackedFallbackNode: ReplayNode | null; // born null; stored 4156
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 6. Postponing and replaying. THE LEGACY BUNDLE NEVER POSTPONES AND NEVER RESUMES: Request.trackedPostpones is born null and never stored again,
  //    no task is born with a replay from outside: the code for both is in the text all the same, and is typed.
  // -------------------------------------------------------------------------------------------------------------------
  interface PostponedHoles { workingMap: Map<KeyNode, ReplayNode>; rootNodes: ReplayNode[]; rootSlots: ResumeSlots } // NO BIRTH in the legacy bundle
  interface ReplaySet { nodes: ReplayNode[]; slots: ResumeSlots; pendingTasks: number } // birth 4412 4495 4533 4648

  // -------------------------------------------------------------------------------------------------------------------
  // 7. The DOM side: RenderState, ResumableState, FormatContext, resources
  // -------------------------------------------------------------------------------------------------------------------
  interface RenderState { // birth 2750
    placeholderPrefix: PrecomputedChunk;
    segmentPrefix: PrecomputedChunk;
    boundaryPrefix: PrecomputedChunk;
    startInlineScript: PrecomputedChunk;
    preamble: PreambleState;
    externalRuntimeScript: null; // never stored again, never read
    bootstrapChunks: Chunk[];
    importMapChunks: Chunk[];
    onHeaders: OnHeaders | null | undefined; // undefined at the birth, never stored again: read once (4964)
    headers: PreloadHeaders | null; // null at the birth, never a PreloadHeaders in the legacy bundle (stored null again 4968)
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
    stylesToHoist: boolean;
    generateStaticMarkup: boolean; // THE LEGACY BUNDLE's OWN RenderState: no hoistableState; this member last. 19.1.0: no startInlineStyle, no nonce
  }
  type OnHeaders = (headers: PropsBag) => void; // is handed { Link } (5015) or {}
  interface PreloadHeaders { preconnects: string; fontPreloads: string; highImagePreloads: string; remainingCapacity: HeaderCapacity } // NO BIRTH in the legacy bundle
  interface ResourceResets { font: ResourceDict; dns: ExistsDict; connect: ConnectResources; image: ResourceDict; style: ResourceDict } // birth 2761
  interface PreloadMaps { // birth 2659
    images: Map<string, Resource>;
    stylesheets: Map<string, Resource>;
    scripts: Map<string, Resource>;
    moduleScripts: Map<string, Resource>;
  }
  interface ResumableState { // birth 312
    idPrefix: string; // "" | options.identifierPrefix (given: React's type says string)
    nextFormID: number;
    streamingFormat: int32; // 0, never read
    bootstrapScriptContent?: BootstrapScriptContent; // undefined at the one call of the legacy bundle (5840). OPTIONAL as in the other bundles' ResumableState
    bootstrapScripts?: BootstrapScripts; // likewise
    bootstrapModules?: BootstrapScripts; // likewise
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
  interface PreambleState { htmlChunks: Chunk[] | null; headChunks: Chunk[] | null; bodyChunks: Chunk[] | null; contribution: PreambleContribution } // birth 333: createPreambleState: 19.1.0: contribution
  interface FormatContext { // birth 341
    insertionMode: InsertionMode;
    selectedValue: SelectedValue; // null when none
    tagScope: TagScope; // 19.1.0: LAST: no viewTransition
  }
  interface HoistableState { styles: Set<StyleQueue>; stylesheets: Set<StylesheetResource> } // birth 2231: 19.1.0: no suspenseyImages
  interface StyleQueue { precedence: Chunk; rules: Chunk[]; hrefs: Chunk[]; sheets: Map<string, StylesheetResource> } // birth 1377 1529 2487
  interface StylesheetResource { state: StylesheetState; props: PropsBag } // birth 1384 2494: props is what assign() made

  // -------------------------------------------------------------------------------------------------------------------
  // 8. The stacks a task carries
  // -------------------------------------------------------------------------------------------------------------------
  interface ContextNode { // birth 4307. React's ContextSnapshot = ContextNode | null
    parent: ContextNode | null;
    depth: ContextDepth;
    context: ReactContext;
    parentValue: ContextValue;
    value: ContextValue;
  }
  interface ComponentStackNode { parent: ComponentStackNode | null; type: ElementType } // birth 3768
  interface TreeContext { id: TreeId; overflow: string } // birth 2919 2935 2943

  // -------------------------------------------------------------------------------------------------------------------
  // 9. Hooks, the tables of functions handed to react and react-dom, classes
  // -------------------------------------------------------------------------------------------------------------------
  interface Hook { memoizedState: HookState; queue: UpdateQueue | null; next: Hook | null } // birth 3031
  interface UpdateQueue { last: Update | null; dispatch: Dispatch | null } // birth 3092: last is never stored again, never read
  interface Update { action: HookState; next: Update | null } // birth 3129
  interface RefObject { current: any } // birth 3241: handed to the user, kept in Hook.memoizedState
  type Dispatch = (action: any) => void;
  type Reducer = (state: any, action: any) => any;
  /** births 3171 3202: a function; 3175 stores a member on the first */
  interface ActionDispatch { (payload: any): void; $$FORM_ACTION?: (prefix: any) => CustomFormFields }
  /** var HooksDispatcher: FZ.Dispatcher = { .. }: the function expressions in it then need no annotation. react reads it by name off SharedInternals.H */
  interface Dispatcher { // birth 3218
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
  }
  interface AsyncDispatcher { getCacheForType(resourceType?: GivenFunction): any } // birth 3308: it throws
  interface FormStatusNotPending { pending: boolean; data: null; method: null; action: null } // birth 282: handed to the user
  /** stored by name to DOMSharedInternals.d: react-dom reads it by name */
  interface HostDispatcher { // birth 289
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
  interface ClassComponentUpdater { // birth 2907
    enqueueSetState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueReplaceState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueForceUpdate(inst?: ClassInstance, callback?: any): void;
  }
  interface InternalInstance { queue: any[] | null; replace: boolean } // birth 3894: stored by name to ClassInstance._reactInternals (3895), comes back as any (2909 2913)

  // -------------------------------------------------------------------------------------------------------------------
  // 10. Small things, and what is handed to the user
  // -------------------------------------------------------------------------------------------------------------------
  /** BORN EMPTY: {}. The one member says: there is no member: so that no other shape is assignable to it. Made for every function component rendered; compared by === (dispatchAction) */
  interface ComponentIdentity { readonly $$fzIdentity?: never } // birth 3815
  /** BORN EMPTY: {}. emptyContextObject: handed to the user's classes as their context */
  interface EmptyContext { readonly $$fzEmptyContext?: never } // birth 2851
  interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } } // birth 3338 (not in births.txt)
}

// ---------------------------------------------------------------------------------------------------------------------
// Globals the bundle names and the checker's library (ES only) lacks. Delete this block when a real library is in.
// ---------------------------------------------------------------------------------------------------------------------
declare var require: (name: string) => any;
declare var exports: any;
declare var console: { error(...data: any[]): void };

// ---------------------------------------------------------------------------------------------------------------------
// A. THE MODULE-LEVEL VARIABLES (86 declarators). Not listed = a constant symbol | regular expression | string: leave it to inference
//    (the 18 REACT_* at 53..70, REACT_CLIENT_REFERENCE, MAYBE_ITERATOR_SYMBOL, the 12 patterns, actionJavaScriptURL). The others:
//    19.1.0 HAS NO currentlyFlushingRenderState, flushedByteSize, flushingPartialBoundaries.
// ---------------------------------------------------------------------------------------------------------------------
//   36 React                                       FZ.ReactModule
//   37 ReactDOM                                    FZ.ReactDOMModule
//   72 isArrayImpl                                 inference (Array.isArray: a type guard to any[])
//  126 assign                                      FZ.Assign
//  127 hasOwnProperty                              inference
//  131 illegalAttributeNameCache                   FZ.NameCache
//  132 validatedAttributeNameCache                 FZ.NameCache
//  142 unitlessNumbers                             Set<string>            (inference gives it)
//  147 aliases                                     Map<string, string>    (inference gives it)
//  278 ReactSharedInternals                        FZ.SharedInternals
//  280 ReactDOMSharedInternals                     FZ.DOMSharedInternals
//  282 sharedNotPendingObject                      FZ.FormStatusNotPending
//  288 previousDispatcher                          FZ.HostDispatcherGiven
//  289 ReactDOMSharedInternals.d = { .. }          no variable: the literal goes into any: = { .. }/*$*/ as FZ.HostDispatcher/*$*/;
//  300 PRELOAD_NO_CREDS                            FZ.PreloadState
//  387 styleNameCache                              Map<string, FZ.Chunk>
//  842 validatedTagCache                           Map<string, FZ.Chunk>
// 1856 endTagCache                                 Map<string, FZ.Chunk>
// 2032 currentlyRenderingBoundaryHasStylesToHoist  boolean
// 2033 destinationHasCapacity                      boolean
// 2070 stylesheetFlushingQueue                     FZ.Chunk[]
// 2797 bind                                        inference
// 2851 emptyContextObject                          FZ.EmptyContext
// 2852 currentActiveSnapshot                       FZ.ContextNode | null
// 2907 classComponentUpdater                       FZ.ClassComponentUpdater
// 2919 emptyTreeContext                            FZ.TreeContext
// 2948 clz32                                       (x: number) => number
// 2949 log · 2950 LN2                              inference
// 2955 SuspenseException                           inference (Error)
// 2998 suspendedThenable                           FZ.Thenable            (null when none)
// 3008 objectIs                                    (x: any, y: any) => boolean
// 3009 currentlyRenderingComponent                 FZ.ComponentIdentity | null
// 3010 currentlyRenderingTask                      FZ.Task | null
// 3011 currentlyRenderingRequest                   FZ.Request | null
// 3012 currentlyRenderingKeyPath                   FZ.KeyNode | null
// 3013 firstWorkInProgressHook                     FZ.Hook | null
// 3014 workInProgressHook                          FZ.Hook | null
// 3015 isReRender · 3016 didScheduleRenderPhaseUpdate   boolean
// 3017 localIdCounter · 3018 actionStateCounter · 3019 actionStateMatchingIndex · 3020 thenableIndexCounter   FZ.HookCounter
// 3021 thenableState                               FZ.ThenableState | null
// 3022 renderPhaseUpdates                          Map<FZ.UpdateQueue, FZ.Update> | null
// 3023 numberOfReRenders                           FZ.HookCounter
// 3218 HooksDispatcher                             FZ.Dispatcher
// 3307 currentResumableState                       FZ.ResumableState | null
// 3308 DefaultAsyncDispatcher                      FZ.AsyncDispatcher
// 3313 prefix · 3314 suffix                        string | undefined
// 3331 reentry                                     boolean
// 3623 currentRequest                              FZ.Request | null

// ---------------------------------------------------------------------------------------------------------------------
// B. A PARAMETER'S NAME SAYS ITS TYPE, in all 146 functions, so that the 10 pieces agree. THE TYPE THAT ARRIVES (rule 4a's name$given).
// ---------------------------------------------------------------------------------------------------------------------
// request request$jscomp$0 request$jscomp$2   FZ.Request
// task                                        FZ.Task
// destination                                 FZ.Destination
// target target$jscomp$0                      FZ.Chunk[]             (adoptPreloadCredentials: FZ.PropsBag)
// renderState · resumableState                FZ.RenderState · FZ.ResumableState
// preambleState                               FZ.PreambleState       (pushStartInstance: | null)
// formatContext parentContext parentFormatContext rootFormatContext   FZ.FormatContext
// hoistableState                              FZ.HoistableState | null   (never null: writeHoistablesForBoundary writeStyleResourceDependenciesInJS flushSegmentContainer)
// segment                                     FZ.Segment             (finishedTask: | null)
// boundary                                    FZ.SuspenseBoundary    (| null: createPendingSegment abortRemainingReplayNodes finishedTask)
// blockedBoundary · blockedSegment · blockedPreamble   FZ.SuspenseBoundary | null · FZ.Segment · FZ.PreambleState | null
// abortSet fallbackAbortableTasks             Set<FZ.Task>
// contentPreamble fallbackPreamble (createSuspenseBoundary)   FZ.PreambleState | null
// keyPath                                     FZ.KeyNode             (createRenderTask createReplayTask: | null)
// context                                     FZ.ContextNode | null
// prev next · newSnapshot                     FZ.ContextNode · FZ.ContextNode | null
// treeContext baseContext                     FZ.TreeContext
// componentStack node$jscomp$0 (getThrownInfo)   FZ.ComponentStackNode | null
// thenableState                               FZ.ThenableState | null   (trackUsedThenable: never null)
// replay · nodes · slots                      FZ.ReplaySet · FZ.ReplayNode[] · FZ.ResumeSlots
// node                                        FZ.ReactNode
// children                                    FZ.ReactNode           (renderChildrenArray: FZ.ReactNode[])
// props · type · ref                          FZ.Props · FZ.ElementType (string: getChildFormatContext pushStartInstance) · FZ.Ref
// Component · secondArg · fn                  FZ.FunctionComponent · FZ.Ref · FZ.ElementType
// styleQueue · stylesheet · resource          FZ.StyleQueue · FZ.StylesheetResource · FZ.Resource
// collectedPreambleSegments                   FZ.Segment[][]
// errorInfo · errorDigest$jscomp$0            FZ.ThrownInfo · FZ.ErrorDigest
// error reason                                FZ.Thrown              (renderToStringImpl's abortReason: string)
// thenable                                    FZ.Thenable
// options                                     FZ.Options
// value style innerHTML href as src crossOrigin precedence formEncType formMethod formTarget
//   text url permalink initialState initialArg state action params key   FZ.PropValue or the nearer GIVEN alias: all any
// formAction · selectedValue · formState      FZ.FormAction · FZ.SelectedValue · FZ.ReactFormState   (createRequest: formState?: its one call, 5841, hands over 11 of the 12; RequestInstance makes undefined null)
// identifierPrefix externalRuntimeConfig bootstrapScriptContent bootstrapScripts bootstrapModules   FZ.PropValue or the nearer GIVEN alias (off the options)
// progressiveChunkSize onError onAllReady onShellReady onShellError onFatalError onPostpone   as in FZ.RequestConstructor, IN THAT ORDER
// name tag attributeName match prefix s suffix input   string   (FZ.PropValue: pushFormActionAttribute's and describeBuiltInComponentFrame's name)
// childIndex                                  FZ.ChildIndex
// id segmentId                                FZ.SegmentId
// index totalChildren                         FZ.int32 (createPendingSegment's index: FZ.ChunkIndex) · actionStateCount actionStateMatchingIndex: FZ.HookCounter · insertionMode: FZ.InsertionMode · tagScope: FZ.TagScope
// textEmbedded lastPushedText hasId construct shellComplete generateStaticMarkup isFallback (19.1.0)   boolean
// preloadState                                FZ.PreloadState
// reducer · init · nextCreate · deps          FZ.Reducer · ((initialArg: any) => any) | undefined · () => any · FZ.HookDeps
// componentIdentity · queue                   FZ.ComponentIdentity · FZ.UpdateQueue
// x y                                         number (clz32Fallback) · any (is)
// `this`: FZ.Chunk[] pushAdditionalFormField · FZ.Destination flushStyleTagsLateForBoundary flushResource flushStyleInPreamble flushStylesInPreamble
//   preloadLateStyle preloadLateStyles · FZ.HoistableState hoistStyleQueueDependency hoistStylesheetDependency · FZ.Request abortTaskSoft RequestInstance

// ---------------------------------------------------------------------------------------------------------------------
// C. RESULTS that callers in other pieces lean on. Not listed = void, or plain to inference.
// ---------------------------------------------------------------------------------------------------------------------
// string: escapeTextForBrowser scriptReplacer styleReplacer escapeJS*ForInstructionScripts getPreloadAsHeader the two escape*Replacer flattenOptionChildren
//   describeBuiltInComponentFrame describeNativeComponentFrame describeComponentStackByType renderToStringImpl · FZ.ComponentName: getComponentNameFromType
// FZ.Chunk: startChunkForTag endChunkForTag · number: clz32Fallback murmurhash3_32_gc
// boolean: isAttributeNameSafe pushTextInstance writeBootstrap writeStartPendingSuspenseBoundary writeStartSegment writeEndSegment hasStylesToHoist
//   writeHoistablesForBoundary is preparePreambleFromSubtree preparePreambleFromSegment
//   flushSubtree flushSegment flushSegmentContainer flushCompletedBoundary flushPartiallyCompletedSegment
// null: pushLinkImpl pushSelfClosing pushTitleImpl pushScriptImpl defaultErrorHandler
// FZ.ReactNode: pushStartSingletonElement pushStartGenericElement pushStartInstance renderWithHooks · any under its alias: trackUsedThenable unwrapThenable basicStateReducer useMemo
// sanitizeURL<T>(url: T): T | string
// getCustomFormFields: FZ.CustomFormFields · pushFormActionAttribute: FZ.FormDataGiven
// createRenderState: FZ.RenderState · createResumableState: FZ.ResumableState · createHoistableState: FZ.HoistableState · createPreambleState (19.1.0): FZ.PreambleState
// createFormatContext (19.1.0: three parameters) getChildFormatContext: FZ.FormatContext
// pushTreeContext: FZ.TreeContext
// getSuspendedThenable: FZ.Thenable · getThenableStateAfterSuspending: FZ.ThenableState | null · resolveCurrentlyRenderingComponent: FZ.ComponentIdentity
// createHook createWorkInProgressHook: FZ.Hook · useReducer: FZ.DispatchTuple · useActionState: FZ.ActionStateTuple
// createRequest: FZ.Request
// createSuspenseBoundary: FZ.SuspenseBoundary · createRenderTask createReplayTask spawnNewSuspendedReplayTask spawnNewSuspendedRenderTask: FZ.Task
// createPendingSegment: FZ.Segment
// getThrownInfo: FZ.ThrownInfo · logRecoverableError: FZ.ErrorDigest
// renderNode renderNodeDestructive retryNode: void (they `return` the void of one another)

// ---------------------------------------------------------------------------------------------------------------------
// D. BIRTHS LEFT WITHOUT AN INTERFACE, ON PURPOSE: literals handed straight to a built-in, to given code, or to a for..in of ours, never stored to again.
// ---------------------------------------------------------------------------------------------------------------------
// 3345 { set } 3393 3790 { value } 3774 { configurable, enumerable, get } -> Object.defineProperty
// 5015 { Link } | {} -> onHeaders · 5862 { push, destroy } -> startFlowing's destination (any: read by name)
// 1692 4994 -> getPreloadAsHeader's params (for..in) · 1707 2109 2261 2311 -> pushLinkImpl's props (for..in) · 1386 { data-precedence, precedence } -> a source of assign()
// DICTIONARIES, NOT LAYOUTS (section 3): 2671 2715 and the first arguments of assign (1386 1455 2356 2370 2388 2422 2467 2497 2524 2550 3878 3907 3949): FZ.PropsBag ·
//   324 2764 { default, anonymous, credentials }: FZ.ConnectResources

// ---------------------------------------------------------------------------------------------------------------------
// E. THE VARIABLES THAT HOLD TWO OR MORE KINDS OF OBJECT: p = a parameter (rule 4a) · l = a local (rule 4c: a marked variable a role).
//    THE LISTS OF 19.3.0's AND 19.2.8's BUNDLES DO NOT HOLD HERE (every version's compiler run reuses other variables: renderElement is one function here and reuses all six
//    of its parameters). THE TEXT ITSELF IS THE LIST: grep -n '\$given\|\$as[A-Z]' parts/*.cts ; births.txt's last section lists the parameters that are stored to;
//    python3 splits.py all says whether every split is the bundle's own program.
//    A variable that STARTS as any (var key = node.key) stays any for the checker: a born literal stored to it is checked against nothing: split that role off too.
// ---------------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------------
// F. IDIOMS, probed on the checker
// ---------------------------------------------------------------------------------------------------------------------
// catch (x: FZ.Thrown) · new Set<FZ.Task>() (3540 4121 4475 4890) · new Map<FZ.KeyNode, FZ.ReplayNode>() comes by itself where the literal around it is typed
// an array literal becomes a tuple only against its type: a variable annotated FZ.KeyNode | FZ.ReplayNode, or a marked cast behind it
// dict.hasOwnProperty(key) is Object's own method, not the index signature · delete slots[i] and for (var index in slots) pass on FZ.SlotMap · slots[i] reads as SegmentId | undefined BY THE ALIAS: no cast; "number" === typeof narrows both branches (the other dictionaries are only read behind hasOwnProperty: their values carry no undefined)
// var bucket: FZ.ConnectBucket | FZ.Resource · boundary.length = 4 passes on FZ.ReplayNode (4715)
// pushAllNext(newSnapshot!) (2897): TS2345: `bang` does not put that one · task.replay! task.blockedSegment! wherever React knows which kind of task it holds
