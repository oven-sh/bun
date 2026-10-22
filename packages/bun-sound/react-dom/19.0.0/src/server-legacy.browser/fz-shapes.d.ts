// fz-shapes.d.ts: the shapes of react-dom 19.0.0, cjs/react-dom-server-legacy.browser.production.js (Fizz, the legacy bundle). READ OFF THE BUNDLE'S OWN BIRTHS
// (carried over from 19.1.0's shapes, which came from 19.2.8's; where this version's birth has other members the interface is THIS version's, and says "19.0.0"):
// the members of an interface stand in the order in which the birth STORES them (a chain this.a = this.b = 0 stores b first).
// "birth NNNN" = line of original.js. "given" = the value is made elsewhere (react, react-dom, Bun, Node, the user).
// CHECKED BY PROGRAM (python3 shapes_check.py): the births named behind the heads have their interface's members, in its order; no two births of one interface differ. births.txt (python3 births.py): every birth of this bundle.
// THE CHECKER DOES NOT LOOK INTO A .d.ts (it says "0 files"; a name that does not exist there is silently any): python3 shapes_check.py checks all fz-shapes*.d.ts as .ts, and the births again.
// WHAT 19.2.8 HAS AND THIS VERSION HAS NOT: SuspenseListRow (Task.row, SuspenseBoundary.row: <SuspenseList> is rendered as a fragment here), ViewTransitionContext (FormatContext.viewTransition),
//   NoncePair (RenderState.nonce), RenderState.startInlineStyle, HoistableState.suspenseyImages, Request.byteSize, Dispatcher.useEffectEvent, AsyncDispatcher.cacheSignal,
//   trackPostpone (so: no birth of a SlotMap, none of a 6-long ReplayNode), the "Suspense Fallback" ComponentStackNode, the bits of TagScope above 2 and of InstructionState above 16.
// WHAT 19.1.0 HAS AND THIS VERSION HAS NOT: PreambleState and all that hangs on it: RenderState.preamble (here: RenderState.htmlChunks, RenderState.headChunks), Request.completedPreambleSegments, Task.blockedPreamble,
//   Segment.preambleChildren, SuspenseBoundary.contentPreamble | fallbackPreamble, PreambleContribution, the insertion mode HTML_HEAD (SVG .. COLGROUP are one less here).
// WHAT THIS VERSION HAS AND 19.1.0 HAS NOT: ClassComponentUpdater.isMounted (first). OTHER ORDER: Segment (parentFlushed fourth), Dispatcher (useCacheRefresh useMemoCache useHostTransitionStatus useOptimistic; useFormState and useActionState are stored BEHIND the literal: optional).
// AS IN 19.1.0, NOT IN 19.2.8: Task.isFallback (last).
declare namespace FZ {
  // -------------------------------------------------------------------------------------------------------------------
  // 1. Numbers. int32: four bytes and integer arithmetic; the build proves every value that is stored there, or stops.
  // -------------------------------------------------------------------------------------------------------------------
  type int32 = import("bun").int32;
  type RequestStatus = int32; // Request.status: 10 OPENING 11 OPEN 12 ABORTING 13 CLOSING 14 CLOSED
  type SegmentStatus = int32; // Segment.status: 0 PENDING 1 COMPLETED 2 FLUSHED 3 ABORTED 4 ERRORED 5 POSTPONED (tested, never stored) 6 RENDERING
  type BoundaryStatus = int32; // SuspenseBoundary.status: 0 PENDING 1 COMPLETED 4 CLIENT_RENDERED: no others stored or tested
  type StylesheetState = int32; // StylesheetResource.state: 0 PENDING 1 PRELOADED 2 PREAMBLE 3 LATE
  type InsertionMode = int32; // 19.0.0: 0 ROOT_HTML 1 HTML_HTML 2 HTML 3 SVG 4 MATHML 5 TABLE 6 TABLE_BODY 7 TABLE_ROW 8 COLGROUP: no HTML_HEAD
  type TagScope = int32; // bits, 19.0.0 as 19.1.0: 1 NOSCRIPT 2 PICTURE: no others
  type InstructionState = int32; // bits, 19.0.0 as 19.1.0: 1 $RS 2 $RC 4 $RX 8 $RR 16 form replay: no others
  type SegmentId = int32; // Segment.id, SuspenseBoundary.rootSegmentID, Request.nextSegmentId: -1 = none yet
  type ChildIndex = int32; // Task.childIndex: -1 = not a child of an array
  type TaskCount = int32; // every pendingTasks | allPendingTasks | pendingRootTasks
  type ChunkIndex = int32; // Segment.index, a length of chunks | children
  type TreeId = int32; // TreeContext.id: made by << | & alone
  type ContextDepth = int32;
  type HookCounter = int32; // localIdCounter actionStateCounter actionStateMatchingIndex (-1) thenableIndexCounter numberOfReRenders
  type ByteSize = number; // sums of chunks' lengths by React's model: NOT int32. 19.0.0's legacy bundle: SuspenseBoundary.byteSize alone: born 0 (3555), never stored again, compared with progressiveChunkSize (5180)
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
  type IteratorFn = any; // no getIteratorFn: retryNode reads node[Symbol.iterator] || node["@@iterator"] itself (4426): that function (null when none), and the iterator and steps it gives
  type Destination = any; // renderToStringImpl's { push, destroy } (5596): read by name. null when none
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
  type PropsBag = { [name: string]: any }; // props MADE here: {} 3779 4128 · 2590 2634 (members are ADDED behind the birth) · every first argument and result of assign()
  type Assign = (target: PropsBag, ...sources: any[]) => PropsBag; // var assign: so that its literal first arguments are checked as dictionaries
  type NameCache = { [name: string]: boolean }; // births 131 132
  type PreloadState = PropValue[]; // [] (PRELOAD_NO_CREDS 300, one array, compared by .length) | [crossOrigin, integrity] births 2297 2315 2374 4853
  type ResourceDict = { [key: string]: PreloadState | null }; // null = Exists. births 325..327 329 2325 2382 2682 2685 2686
  type ExistsDict = { [key: string]: null }; // births 323 324 2683 2684
  type UnknownResourceDict = { [as: string]: ResourceDict }; // births 322 328
  type ConnectBucket = "default" | "anonymous" | "credentials";
  type ConnectResources = { [bucket: string]: ExistsDict }; // births 324 2684: { default, anonymous, credentials }: only ever read as [bucket]
  type SlotMap = { [index: string]: SegmentId | undefined }; // NO BIRTH in this bundle (no trackPostpone). READ FOR EVERY CHILD INDEX, also those without a slot, and told apart by "number" === typeof (4541 4542): undefined = absent; members are deleted as they are resumed (4544) or aborted (4753)
  type ThrownInfo = { [name: string]: unknown }; // births 3679 4862 5089 5534 5560: {}; componentStack is an ACCESSOR put by Object.defineProperty. Only handed to onError

  // TUPLES: arrays the bundle builds; JSON.stringify sees the first (useActionState) and the second (the postponed state).
  type KeyNode = [parent: KeyNode | null, name: ComponentName, keyOrIndex: KeyOrIndex]; // births 4017 4111 4250 4392 4485
  /**
   * birth 4018 (4 long); NO BIRTH of a 6 long one in this bundle. ONE TYPE all the same: the text reads node[4] node[5] (4316..4322 4733) and makes a 6 into a 4 by .length = 4 (4564).
   * 4 === node.length tells them apart but does not narrow: node[4]! node[5]! in the other branch.
   */
  type ReplayNode = [name: ComponentName, keyOrIndex: KeyOrIndex, children: ReplayNode[], slots: ResumeSlots, fallback?: ReplayNode | null, rootSegmentID?: SegmentId];
  type ResumeSlots = SlotMap | SegmentId | null; // null nothing · a number: resume at the root position · a map: child index -> segment id
  type ThenableState = Thenable[]; // birth 3132
  type MemoState = [value: any, deps: HookDeps]; // birth 3042, in Hook.memoizedState
  type DispatchTuple = [state: HookState, dispatch: Dispatch | null]; // births 3000 3002 3019
  type OptimisticTuple = [state: HookState, dispatch: Dispatch]; // birth 3221
  type TransitionTuple = [isPending: boolean, start: (callback?: GivenFunction) => void]; // birth 3184
  type ActionStateTuple = [state: HookState, dispatch: ActionDispatch, isPending: boolean]; // births 3118 3121
  type ComponentFrameSample = [sample: string | null, control: string | null]; // births 3296 3298

  // -------------------------------------------------------------------------------------------------------------------
  // 4. Request
  // -------------------------------------------------------------------------------------------------------------------
  interface Request { // birth 3446 RequestInstance
    destination: Destination; // null when none
    flushScheduled: boolean;
    resumableState: ResumableState;
    renderState: RenderState;
    rootFormatContext: FormatContext;
    progressiveChunkSize: number; // 12800 | what is handed over: Infinity at the one call of the legacy bundle (5580): NOT int32
    status: RequestStatus;
    fatalError: Thrown; // null until fatalError() | abort()
    nextSegmentId: number;
    allPendingTasks: number;
    pendingRootTasks: number;
    completedRootSegment: Segment | null;
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
  // 5. Task, Segment, SuspenseBoundary (no SuspenseListRow, no preambles)
  // -------------------------------------------------------------------------------------------------------------------
  /** React's RenderTask (3584: replay null, blockedSegment a Segment) and ReplayTask (3627: replay a ReplaySet, blockedSegment null): THE SAME MEMBERS IN THE SAME ORDER, and resumeNode (4198) turns one into the other and back: ONE SHAPE */
  interface Task { // birth 3584 3627
    replay: ReplaySet | null;
    node: ReactNode;
    childIndex: ChildIndex;
    ping: Ping;
    blockedBoundary: SuspenseBoundary | null; // null = the root
    blockedSegment: Segment | null;
    hoistableState: HoistableState | null;
    abortSet: Set<Task>;
    keyPath: KeyNode | null; // null = the root
    formatContext: FormatContext;
    context: ContextNode | null;
    treeContext: TreeContext;
    componentStack: ComponentStackNode | null;
    thenableState: ThenableState | null;
    isFallback: boolean; // LAST. the task renders a Suspense fallback: false at the root (3535), true at 4116 4397, else the parent task's; handed on to pushStartInstance (3900)
  }
  type Ping = () => void; // a FUNCTION (3588 3631), no record: handed to thenable.then(ping, ping)
  interface Segment { // birth 3657
    status: SegmentStatus;
    id: number;
    index: ChunkIndex; // where in the parent's chunks it goes
    parentFlushed: boolean; // 19.0.0: FOURTH, behind index
    chunks: Chunk[];
    children: Segment[];
    parentFormatContext: FormatContext;
    boundary: SuspenseBoundary | null;
    lastPushedText: boolean;
    textEmbedded: boolean;
  }
  interface SuspenseBoundary { // birth 3549
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
    trackedContentKeyPath: KeyNode | null; // born null; stored 3996
    trackedFallbackNode: ReplayNode | null; // born null; stored 4020
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 6. Postponing and replaying. THE LEGACY BUNDLE NEVER POSTPONES AND NEVER RESUMES: Request.trackedPostpones is born null and never stored again,
  //    no task is born with a replay from outside: the code for both is in the text all the same, and is typed.
  // -------------------------------------------------------------------------------------------------------------------
  interface PostponedHoles { workingMap: Map<KeyNode, ReplayNode>; rootNodes: ReplayNode[]; rootSlots: ResumeSlots } // NO BIRTH in the legacy bundle
  interface ReplaySet { nodes: ReplayNode[]; slots: ResumeSlots; pendingTasks: number } // birth 4266 4339 4382 4497

  // -------------------------------------------------------------------------------------------------------------------
  // 7. The DOM side: RenderState, ResumableState, FormatContext, resources
  // -------------------------------------------------------------------------------------------------------------------
  interface RenderState { // birth 2669
    placeholderPrefix: PrecomputedChunk;
    segmentPrefix: PrecomputedChunk;
    boundaryPrefix: PrecomputedChunk;
    startInlineScript: PrecomputedChunk;
    htmlChunks: Chunk[] | null; // 19.0.0: no PreambleState: <html>'s and <head>'s start tags are kept in the RenderState itself: born null
    headChunks: Chunk[] | null; // likewise
    externalRuntimeScript: null; // never stored again, never read
    bootstrapChunks: Chunk[];
    importMapChunks: Chunk[];
    onHeaders: OnHeaders | null | undefined; // undefined at the birth, never stored again: read once (4807)
    headers: PreloadHeaders | null; // null at the birth, never a PreloadHeaders in the legacy bundle (stored null again 4811)
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
    generateStaticMarkup: boolean; // THE LEGACY BUNDLE's OWN RenderState: no hoistableState; this member last. No startInlineStyle, no nonce
  }
  type OnHeaders = (headers: PropsBag) => void; // is handed { Link } (4858) or {}
  interface PreloadHeaders { preconnects: string; fontPreloads: string; highImagePreloads: string; remainingCapacity: HeaderCapacity } // NO BIRTH in the legacy bundle
  interface ResourceResets { font: ResourceDict; dns: ExistsDict; connect: ConnectResources; image: ResourceDict; style: ResourceDict } // birth 2681
  interface PreloadMaps { // birth 2578
    images: Map<string, Resource>;
    stylesheets: Map<string, Resource>;
    scripts: Map<string, Resource>;
    moduleScripts: Map<string, Resource>;
  }
  interface ResumableState { // birth 312
    idPrefix: string; // "" | options.identifierPrefix (given: React's type says string)
    nextFormID: number;
    streamingFormat: int32; // 0, never read
    bootstrapScriptContent?: BootstrapScriptContent; // undefined at the one call of the legacy bundle (5574). OPTIONAL as in the other bundles' ResumableState
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
  interface FormatContext { // birth 333
    insertionMode: InsertionMode;
    selectedValue: SelectedValue; // null when none
    tagScope: TagScope; // LAST: no viewTransition
  }
  interface HoistableState { styles: Set<StyleQueue>; stylesheets: Set<StylesheetResource> } // birth 2152: no suspenseyImages
  interface StyleQueue { precedence: Chunk; rules: Chunk[]; hrefs: Chunk[]; sheets: Map<string, StylesheetResource> } // birth 1344 1496 2407
  interface StylesheetResource { state: StylesheetState; props: PropsBag } // birth 1351 2414: props is what assign() made

  // -------------------------------------------------------------------------------------------------------------------
  // 8. The stacks a task carries
  // -------------------------------------------------------------------------------------------------------------------
  interface ContextNode { // birth 4161. React's ContextSnapshot = ContextNode | null
    parent: ContextNode | null;
    depth: ContextDepth;
    context: ReactContext;
    parentValue: ContextValue;
    value: ContextValue;
  }
  interface ComponentStackNode { parent: ComponentStackNode | null; type: ElementType } // birth 3675
  interface TreeContext { id: TreeId; overflow: string } // birth 2840 2856 2864

  // -------------------------------------------------------------------------------------------------------------------
  // 9. Hooks, the tables of functions handed to react and react-dom, classes
  // -------------------------------------------------------------------------------------------------------------------
  interface Hook { memoizedState: HookState; queue: UpdateQueue | null; next: Hook | null } // birth 2952
  interface UpdateQueue { last: Update | null; dispatch: Dispatch | null } // birth 3013: last is never stored again, never read
  interface Update { action: HookState; next: Update | null } // birth 3050
  interface RefObject { current: any } // birth 3161: handed to the user, kept in Hook.memoizedState
  type Dispatch = (action: any) => void;
  type Reducer = (state: any, action: any) => any;
  /** births 3092 3123: a function; 3096 stores a member on the first */
  interface ActionDispatch { (payload: any): void; $$FORM_ACTION?: (prefix: any) => CustomFormFields }
  /** var HooksDispatcher: FZ.Dispatcher = { .. }: the function expressions in it then need no annotation. react reads it by name off SharedInternals.H */
  interface Dispatcher { // birth 3139
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
    useCacheRefresh(): () => void;
    useMemoCache(size: number): any[];
    useHostTransitionStatus(): FormStatusNotPending;
    useOptimistic(passthrough: any, reducer?: GivenFunction): OptimisticTuple;
    useFormState?(action: FormAction, initialState: any, permalink?: PropValue): ActionStateTuple; // 19.0.0: NOT IN THE LITERAL: stored behind it (3224): optional
    useActionState?(action: FormAction, initialState: any, permalink?: PropValue): ActionStateTuple; // likewise (3225)
  }
  interface AsyncDispatcher { getCacheForType(resourceType?: GivenFunction): any } // birth 3227: it throws
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
  interface ClassComponentUpdater { // birth 2825
    isMounted(inst?: ClassInstance): boolean; // 19.0.0: FIRST: always false
    enqueueSetState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueReplaceState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueForceUpdate(inst?: ClassInstance, callback?: any): void;
  }
  interface InternalInstance { queue: any[] | null; replace: boolean } // birth 3801: stored by name to ClassInstance._reactInternals (3802), comes back as any (2830 2834)

  // -------------------------------------------------------------------------------------------------------------------
  // 10. Small things, and what is handed to the user
  // -------------------------------------------------------------------------------------------------------------------
  /** BORN EMPTY: {}. The one member says: there is no member: so that no other shape is assignable to it. Made for every function component rendered; compared by === (dispatchAction) */
  interface ComponentIdentity { readonly $$fzIdentity?: never } // birth 3722
  /** BORN EMPTY: {}. emptyContextObject: handed to the user's classes as their context */
  interface EmptyContext { readonly $$fzEmptyContext?: never } // birth 2769
  interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } } // birth 3257 (not in births.txt)
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
//    19.0.0 HAS NO currentlyFlushingRenderState, flushedByteSize, flushingPartialBoundaries.
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
//  378 styleNameCache                              Map<string, FZ.Chunk>
//  810 validatedTagCache                           Map<string, FZ.Chunk>
// 1801 endTagCache                                 Map<string, FZ.Chunk>
// 1953 currentlyRenderingBoundaryHasStylesToHoist  boolean
// 1954 destinationHasCapacity                      boolean
// 1991 stylesheetFlushingQueue                     FZ.Chunk[]
// 2717 bind                                        inference
// 2769 emptyContextObject                          FZ.EmptyContext
// 2770 currentActiveSnapshot                       FZ.ContextNode | null
// 2825 classComponentUpdater                       FZ.ClassComponentUpdater
// 2840 emptyTreeContext                            FZ.TreeContext
// 2869 clz32                                       (x: number) => number
// 2870 log · 2871 LN2                              inference
// 2876 SuspenseException                           inference (Error)
// 2919 suspendedThenable                           FZ.Thenable            (null when none)
// 2929 objectIs                                    (x: any, y: any) => boolean
// 2930 currentlyRenderingComponent                 FZ.ComponentIdentity | null
// 2931 currentlyRenderingTask                      FZ.Task | null
// 2932 currentlyRenderingRequest                   FZ.Request | null
// 2933 currentlyRenderingKeyPath                   FZ.KeyNode | null
// 2934 firstWorkInProgressHook                     FZ.Hook | null
// 2935 workInProgressHook                          FZ.Hook | null
// 2936 isReRender · 2937 didScheduleRenderPhaseUpdate   boolean
// 2938 localIdCounter · 2939 actionStateCounter · 2940 actionStateMatchingIndex · 2941 thenableIndexCounter   FZ.HookCounter
// 2942 thenableState                               FZ.ThenableState | null
// 2943 renderPhaseUpdates                          Map<FZ.UpdateQueue, FZ.Update> | null
// 2944 numberOfReRenders                           FZ.HookCounter
// 3139 HooksDispatcher                             FZ.Dispatcher
// 3226 currentResumableState                       FZ.ResumableState | null
// 3227 DefaultAsyncDispatcher                      FZ.AsyncDispatcher
// 3232 prefix · 3233 suffix                        string | undefined
// 3250 reentry                                     boolean
// 3541 currentRequest                              FZ.Request | null

// ---------------------------------------------------------------------------------------------------------------------
// B. A PARAMETER'S NAME SAYS ITS TYPE, in all 137 functions, so that the 9 pieces agree. THE TYPE THAT ARRIVES (rule 4a's name$given).
// ---------------------------------------------------------------------------------------------------------------------
// request request$jscomp$0 request$jscomp$2   FZ.Request
// task                                        FZ.Task
// destination                                 FZ.Destination
// target target$jscomp$0                      FZ.Chunk[]             (adoptPreloadCredentials: FZ.PropsBag)
// renderState · resumableState                FZ.RenderState · FZ.ResumableState
// formatContext parentContext parentFormatContext rootFormatContext   FZ.FormatContext
// hoistableState                              FZ.HoistableState | null   (never null: writeHoistablesForBoundary writeStyleResourceDependenciesInJS flushSegmentContainer)
// segment                                     FZ.Segment             (finishedTask: | null)
// boundary                                    FZ.SuspenseBoundary    (| null: createPendingSegment abortRemainingReplayNodes finishedTask)
// blockedBoundary · blockedSegment            FZ.SuspenseBoundary | null · FZ.Segment
// abortSet fallbackAbortableTasks             Set<FZ.Task>
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
// errorInfo · errorDigest$jscomp$0            FZ.ThrownInfo · FZ.ErrorDigest
// error reason                                FZ.Thrown              (renderToStringImpl's abortReason: string)
// thenable                                    FZ.Thenable
// options                                     FZ.Options
// value style innerHTML href as src crossOrigin precedence formEncType formMethod formTarget
//   text url permalink initialState initialArg state action params key   FZ.PropValue or the nearer GIVEN alias: all any
// formAction · selectedValue · formState      FZ.FormAction · FZ.SelectedValue · FZ.ReactFormState   (createRequest: formState?: its one call, 5575, hands over 11 of the 12; RequestInstance makes undefined null)
// identifierPrefix externalRuntimeConfig bootstrapScriptContent bootstrapScripts bootstrapModules   FZ.PropValue or the nearer GIVEN alias (off the options)
// progressiveChunkSize onError onAllReady onShellReady onShellError onFatalError onPostpone   as in FZ.RequestConstructor, IN THAT ORDER
// name tag attributeName match prefix s suffix input   string   (FZ.PropValue: pushFormActionAttribute's and describeBuiltInComponentFrame's name)
// childIndex                                  FZ.ChildIndex
// id segmentId                                FZ.SegmentId
// index totalChildren                         FZ.int32 (createPendingSegment's index: FZ.ChunkIndex) · actionStateCount actionStateMatchingIndex: FZ.HookCounter · insertionMode: FZ.InsertionMode · tagScope: FZ.TagScope
// textEmbedded lastPushedText hasId construct shellComplete generateStaticMarkup isFallback   boolean
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
//   writeHoistablesForBoundary is
//   flushSubtree flushSegment flushSegmentContainer flushCompletedBoundary flushPartiallyCompletedSegment
// null: pushLinkImpl pushSelfClosing pushTitleImpl pushScriptImpl defaultErrorHandler
// FZ.ReactNode: pushStartGenericElement pushStartInstance renderWithHooks · any under its alias: trackUsedThenable unwrapThenable basicStateReducer useMemo
// sanitizeURL<T>(url: T): T | string
// getCustomFormFields: FZ.CustomFormFields · pushFormActionAttribute: FZ.FormDataGiven
// createRenderState: FZ.RenderState · createResumableState: FZ.ResumableState · createHoistableState: FZ.HoistableState
// createFormatContext (three parameters) getChildFormatContext: FZ.FormatContext
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
// 3264 { set } 3312 3697 { value } 3681 { configurable, enumerable, get } -> Object.defineProperty
// 4858 { Link } | {} -> onHeaders · 5596 { push, destroy } -> startFlowing's destination (any: read by name)
// 1658 4837 -> getPreloadAsHeader's params (for..in) · 1673 2030 2182 2232 -> pushLinkImpl's props (for..in) · 1353 { data-precedence, precedence } -> a source of assign()
// DICTIONARIES, NOT LAYOUTS (section 3): 2590 2634 and the first arguments of assign (1353 1422 2276 2290 2308 2342 2387 2417 2444 2470 3785 3814 3856): FZ.PropsBag ·
//   324 2684 { default, anonymous, credentials }: FZ.ConnectResources

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
// catch (x: FZ.Thrown) · new Set<FZ.Task>() (3459 3993 4329 4736) · new Map<FZ.KeyNode, FZ.ReplayNode>() comes by itself where the literal around it is typed
// an array literal becomes a tuple only against its type: a variable annotated FZ.KeyNode | FZ.ReplayNode, or a marked cast behind it
// dict.hasOwnProperty(key) is Object's own method, not the index signature · delete slots[i] and for (var index in slots) pass on FZ.SlotMap · slots[i] reads as SegmentId | undefined BY THE ALIAS: no cast; "number" === typeof narrows both branches (the other dictionaries are only read behind hasOwnProperty: their values carry no undefined)
// var bucket: FZ.ConnectBucket | FZ.Resource · boundary.length = 4 passes on FZ.ReplayNode (4564)
// pushAllNext(newSnapshot!) (2815): TS2345: `bang` does not put that one · task.replay! task.blockedSegment! wherever React knows which kind of task it holds
